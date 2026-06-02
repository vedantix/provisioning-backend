import { describe, expect, it } from 'vitest';
import { ComparisonService } from '../../../src/modules/migrations/services/comparison.service';
import type {
  MigrationPageRecord,
  MigrationRecord,
} from '../../../src/modules/migrations/types/migration.types';

function migration(): MigrationRecord {
  return {
    pk: 'TENANT#default',
    sk: 'MIGRATION#mig-1',
    entityType: 'MIGRATION',
    tenantId: 'default',
    migrationId: 'mig-1',
    customerId: 'cust_jitan',
    customerName: 'JitanSports',
    sourceUrl: 'https://example.com',
    targetUrl: 'https://jitan-sports.nl',
    status: 'ANALYZED',
    progress: 70,
    counts: { pages: 1, images: 1, faqs: 1, testimonials: 0, ctas: 1 },
    seoScore: 75,
    coverageScore: 80,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  };
}

function page(): MigrationPageRecord {
  return {
    pk: 'TENANT#default',
    sk: 'MIGRATION#mig-1#PAGE#home',
    entityType: 'PAGE',
    tenantId: 'default',
    migrationId: 'mig-1',
    pageId: 'home',
    pageUrl: 'https://example.com/',
    pathname: '/',
    pageType: 'home',
    title: 'Personal training in Den Bosch',
    description: 'Persoonlijke begeleiding voor sporters in Den Bosch.',
    h1: 'JitanSports personal training',
    headings: ['JitanSports personal training'],
    wordCount: 520,
    sections: [{ heading: 'Training', body: 'Persoonlijke trainingen voor duurzame progressie.' }],
    images: [{ imageUrl: 'https://example.com/image.jpg', altText: 'Trainer' }],
    faqs: [{ question: 'Hoe start ik?', answer: 'Plan een intake.' }],
    ctas: [{ label: 'Plan een intake', href: 'https://example.com/contact' }],
    testimonials: [],
    seoScore: 75,
    contentCoverage: 80,
    missingContent: ['Testimonials'],
    aiImprovement: {
      heroTitle: 'Persoonlijke training voor blijvend resultaat',
      heroSubtitle: 'Werk doelgericht aan kracht, conditie en energie.',
      improvedSections: [{ heading: 'Coaching', body: 'Train met begeleiding die past bij je doel.' }],
      improvedSeoTitle: 'Personal trainer Den Bosch | JitanSports',
      improvedSeoDescription: 'Plan een intake bij JitanSports voor persoonlijke training in Den Bosch.',
      recommendedCtas: [{ label: 'Plan een intake', href: 'https://example.com/contact' }],
      notes: [],
    },
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  };
}

describe('ComparisonService', () => {
  it('builds report data and import payload from crawled pages', () => {
    const service = new ComparisonService();
    const report = service.buildReportData(migration(), [page()]);
    const payload = service.buildImportPayload(migration(), [page()]);

    expect(report.missingContent).toContain('Testimonials');
    expect(report.recommendations.some((item) => item.includes('reviews'))).toBe(true);
    expect(payload.pages[0].slug).toBe('home');
    expect(payload.pages[0].hero.title).toBe('Persoonlijke training voor blijvend resultaat');
    expect(payload.pages[0].seo.title).toBe('Personal trainer Den Bosch | JitanSports');
  });
});
