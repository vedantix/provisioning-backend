import { beforeAll, describe, expect, it, vi } from 'vitest';
import type {
  AuditScore,
  CrawlBundle,
  CrawledPage,
} from '../../../src/modules/online-growth-audit/types/online-growth-audit.types';

let services: typeof import('../../../src/modules/online-growth-audit/services/audit-modules.service');
let markContentScoresUnverified: typeof import('../../../src/modules/online-growth-audit/services/online-growth-audit.service').markContentScoresUnverified;

function stubRequiredEnv() {
  vi.stubEnv('AWS_REGION', 'eu-west-1');
  vi.stubEnv('AWS_ACM_REGION', 'us-east-1');
  vi.stubEnv('AWS_ROUTE53_HOSTED_ZONE_ID', 'ZTEST');
  vi.stubEnv('GITHUB_OWNER', 'vedantix');
  vi.stubEnv('GITHUB_TOKEN', 'test-token');
  vi.stubEnv('PROVISIONING_API_KEY', 'test-api-key');
  vi.stubEnv('SQS_QUEUE_URL', 'https://sqs.eu-west-1.amazonaws.com/123/test');
  vi.stubEnv('CUSTOMERS_TABLE', 'vedantix-customers-test');
  vi.stubEnv('DEPLOYMENTS_TABLE', 'vedantix-deployments-test');
  vi.stubEnv('JOBS_TABLE', 'vedantix-jobs-test');
}

function page(overrides: Partial<CrawledPage> = {}): CrawledPage {
  return {
    url: 'https://example.nl/',
    finalUrl: 'https://example.nl/',
    statusCode: 200,
    responseTimeMs: 180,
    bodyBytes: 24_000,
    renderMode: 'BROWSER_RENDERED',
    headers: {
      'strict-transport-security': 'max-age=31536000',
      'content-security-policy': "default-src 'self'; frame-ancestors 'none'",
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin',
    },
    title: 'Voorbeeld webdesign voor ondernemers | Voorbeeld',
    metaDescription: 'Voorbeeld helpt ondernemers met professionele websites, onderhoud en online vindbaarheid in heel Nederland.',
    canonical: 'https://example.nl/',
    headings: { h1: ['Professionele websites voor ondernemers'], h2: ['Onze diensten', 'Werkwijze', 'Veelgestelde vragen'], h3: [] },
    text: 'Voorbeeld helpt ondernemers in Nederland met diensten en oplossingen. Wat kost een website? Bekijk onze cases, resultaten en ervaringen. Neem contact op via info@example.nl of telefoon.',
    wordCount: 620,
    links: ['https://example.nl/contact', 'https://example.nl/privacy', 'https://linkedin.com/company/example'],
    images: [{ src: 'https://example.nl/team.jpg', alt: 'Team van Voorbeeld' }],
    schemaTypes: ['Organization', 'ProfessionalService', 'Service', 'FAQPage'],
    invalidSchemaCount: 0,
    faqSchemaCount: 4,
    hasNoindex: false,
    faqCount: 4,
    ctaCount: 3,
    hasContactForm: true,
    hasPhone: true,
    hasWhatsapp: true,
    hasAppointment: true,
    hasReviews: true,
    hasTestimonials: true,
    hasGoogleMaps: true,
    hasAnalytics: true,
    analyticsProviders: ['Google Tag Manager'],
    hasAddress: true,
    hasEmail: true,
    hasLegalLinks: true,
    hasSocialLinks: true,
    hasReviewPlatformLink: true,
    hasNamedTestimonials: true,
    hasRobotsTxt: true,
    hasSitemapXml: true,
    ...overrides,
  };
}

function bundle(overrides: Partial<CrawlBundle> = {}): CrawlBundle {
  const homepage = page();
  return {
    requestedUrl: homepage.url,
    normalizedUrl: homepage.url,
    host: 'example.nl',
    domain: 'example.nl',
    homepage,
    pages: [homepage, page({ url: 'https://example.nl/contact', finalUrl: 'https://example.nl/contact', title: 'Contact met Voorbeeld', canonical: 'https://example.nl/contact' })],
    robotsAvailable: true,
    sitemapAvailable: true,
    sitemapUrlCount: 12,
    llmsTxtAvailable: true,
    spfPresent: true,
    dmarcPresent: true,
    crawlWarnings: [],
    pagesAttempted: 2,
    ...overrides,
  };
}

beforeAll(async () => {
  stubRequiredEnv();
  services = await import('../../../src/modules/online-growth-audit/services/audit-modules.service');
  ({ markContentScoresUnverified } = await import('../../../src/modules/online-growth-audit/services/online-growth-audit.service'));
});

describe('Online Growth Audit meetmodel', () => {
  it('weegt contentcategorieën niet als echte nullen wanneer de homepage niet is gerenderd', () => {
    const seo: AuditScore = {
      key: 'seo',
      label: 'SEO Audit',
      score: 80,
      status: 'COMPLETED',
      confidence: 'HIGH',
      summary: 'SEO is meetbaar.',
      findings: ['Title gevonden'],
      recommendations: [],
      evidenceItems: [],
      measuredChecks: 1,
      totalChecks: 1,
    };
    const aeo: AuditScore = {
      ...seo,
      key: 'aeo',
      label: 'AEO Audit',
      score: 0,
      findings: [],
      recommendations: ['Voeg FAQ toe'],
      evidenceItems: [{
        check: 'faq',
        label: 'FAQ',
        status: 'FAIL',
        observed: 'Niet gevonden',
        source: 'DOM',
        weight: 100,
      }],
    };

    const result = markContentScoresUnverified([seo, aeo], 0);

    expect(result[0]).toEqual(seo);
    expect(result[1]).toMatchObject({
      key: 'aeo',
      score: null,
      status: 'UNKNOWN',
      confidence: 'LOW',
      measuredChecks: 0,
      recommendations: [],
    });
    expect(result[1].evidenceItems[0].status).toBe('UNKNOWN');
  });

  it('onderbouwt SEO met afzonderlijke controles en bestraft dubbele titles', () => {
    const input = bundle();
    input.pages[1].title = input.homepage.title;
    const result = new services.SEOAuditService().analyze(input);

    expect(result.status).toBe('COMPLETED');
    expect(result.evidenceItems).toHaveLength(9);
    expect(result.evidenceItems.find((item) => item.check === 'unique-titles')?.status).toBe('FAIL');
    expect(result.score).toBeLessThan(100);
  });

  it('verzint geen Google Bedrijfsprofielscore op basis van een Maps-link', () => {
    const result = new services.GoogleBusinessAuditService().analyze(bundle());

    expect(result.score).toBeNull();
    expect(result.status).toBe('UNKNOWN');
    expect(result.findings.join(' ')).toContain('Google Maps');
  });

  it('verzint geen backlinkscore op basis van uitgaande links', () => {
    const result = new services.BacklinkAuditService().analyze(bundle());

    expect(result.score).toBeNull();
    expect(result.evidenceItems[0]).toMatchObject({ status: 'UNKNOWN' });
  });

  it('markeert niet-zichtbare analytics als onbekend in plaats van als slechte score', () => {
    const input = bundle();
    input.pages.forEach((item) => {
      item.hasAnalytics = false;
      item.analyticsProviders = [];
    });
    const result = new services.AnalyticsAuditService().analyze(input);

    expect(result.score).toBeNull();
    expect(result.status).toBe('UNKNOWN');
  });

  it('registreert aantoonbare securityheaders en DNS-signalen als bewijs', () => {
    const result = new services.SecurityAuditService().analyze(bundle());

    expect(result.score).toBe(100);
    expect(result.confidence).toBe('HIGH');
    expect(result.evidenceItems.filter((item) => item.check !== 'dkim').every((item) => item.status === 'PASS')).toBe(true);
    expect(result.evidenceItems.find((item) => item.check === 'dkim')?.status).toBe('UNKNOWN');
  });
});
