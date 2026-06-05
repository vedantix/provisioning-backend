import dns from 'node:dns/promises';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { parse as parseDomain } from 'tldts';
import { BadRequestError } from '../../../errors/app-error';
import type { CrawlBundle, CrawledPage } from '../types/online-growth-audit.types';

const USER_AGENT = 'VedantixOnlineGrowthAudit/2.0 (+https://vedantix.nl)';
const CTA_PATTERN =
  /(contact|afspraak|plan|boek|bel|offerte|gratis|start|aanvragen|whatsapp|advies|kennismaking|proefles|intake|demo)/i;
const PHONE_PATTERN = /(?:\+31|0031|0)\s?[1-9][\d\s().-]{7,}/;
const WHATSAPP_PATTERN = /(wa\.me|whatsapp|api\.whatsapp\.com)/i;
const APPOINTMENT_PATTERN = /(calendly|afspraak|booking|book|plan|reserver|intake|proefles)/i;
const REVIEW_PATTERN = /(review|reviews|beoordeling|beoordelingen|testimonial|ervaring|ervaringen|klanten zeggen|sterren)/i;
const FORM_PATTERN = /<(form)\b/i;
const LOCAL_LOCATION_PATTERN =
  /\b(den bosch|eindhoven|tilburg|breda|nijmegen|amsterdam|rotterdam|utrecht|plaats|regio|omgeving|lokaal)\b/i;

function cleanText(value: string): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\u00a0/g, ' ')
    .trim();
}

function normalizeInputUrl(rawUrl: string): URL {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) {
    throw new BadRequestError('Website URL is verplicht.');
  }

  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    if (!['https:', 'http:'].includes(url.protocol)) {
      throw new Error('Unsupported protocol');
    }
    url.hash = '';
    return url;
  } catch {
    throw new BadRequestError('Website URL is geen geldige URL.');
  }
}

function absolutize(baseUrl: URL, maybeUrl?: string): string | null {
  if (!maybeUrl) return null;
  const trimmed = maybeUrl.trim();
  if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('javascript:')) {
    return null;
  }
  try {
    const url = new URL(trimmed, baseUrl);
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function headerMap(headers: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key.toLowerCase(),
      Array.isArray(value) ? value.join(', ') : String(value ?? ''),
    ]),
  );
}

function extractSchemaTypes($: cheerio.CheerioAPI): string[] {
  const types = new Set<string>();

  $('script[type="application/ld+json"]').each((_index, element) => {
    const raw = $(element).contents().text();
    try {
      const parsed = JSON.parse(raw);
      const nodes = Array.isArray(parsed) ? parsed : [parsed];
      const stack = [...nodes];
      while (stack.length) {
        const current = stack.shift();
        if (!current || typeof current !== 'object') continue;
        const type = (current as Record<string, unknown>)['@type'];
        if (Array.isArray(type)) type.forEach((item) => types.add(String(item)));
        else if (type) types.add(String(type));
        const graph = (current as Record<string, unknown>)['@graph'];
        if (Array.isArray(graph)) stack.push(...graph);
      }
    } catch {
      // Invalid schema is captured by absence of usable schema types.
    }
  });

  return Array.from(types);
}

async function urlAvailable(url: URL): Promise<boolean> {
  try {
    const response = await axios.get(url.toString(), {
      timeout: 7000,
      maxRedirects: 4,
      responseType: 'text',
      headers: { 'User-Agent': USER_AGENT },
      validateStatus: (status) => status >= 200 && status < 500,
    });
    return response.status >= 200 && response.status < 400;
  } catch {
    return false;
  }
}

async function txtContains(domain: string, pattern: RegExp): Promise<boolean> {
  try {
    const records = await dns.resolveTxt(domain);
    return records.flat().some((part) => pattern.test(part));
  } catch {
    return false;
  }
}

function isLikelyHtml(contentType: string, body: string): boolean {
  return contentType.includes('html') || body.includes('<html') || body.includes('<!doctype');
}

async function fetchPage(url: string): Promise<CrawledPage> {
  const start = Date.now();
  const response = await axios.get<string>(url, {
    timeout: 15000,
    maxRedirects: 5,
    responseType: 'text',
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml',
    },
    validateStatus: (status) => status >= 200 && status < 500,
  });
  const responseTimeMs = Date.now() - start;
  const headers = headerMap(response.headers as Record<string, unknown>);
  const body = String(response.data || '');
  const finalUrl = String(response.request?.res?.responseUrl || url);
  const baseUrl = new URL(finalUrl);

  if (!isLikelyHtml(headers['content-type'] || '', body)) {
    throw new BadRequestError('Website URL levert geen HTML-pagina op.');
  }

  const $ = cheerio.load(body);
  const rawHtml = body.toLowerCase();
  const schemaTypes = extractSchemaTypes($);
  const h1 = $('h1')
    .map((_index, element) => cleanText($(element).text()))
    .get()
    .filter(Boolean)
    .slice(0, 12);
  const h2 = $('h2')
    .map((_index, element) => cleanText($(element).text()))
    .get()
    .filter(Boolean)
    .slice(0, 40);
  const h3 = $('h3')
    .map((_index, element) => cleanText($(element).text()))
    .get()
    .filter(Boolean)
    .slice(0, 50);

  const links = $('a[href]')
    .map((_index, element) => absolutize(baseUrl, $(element).attr('href')))
    .get()
    .filter(Boolean)
    .slice(0, 160) as string[];
  const images = $('img')
    .map((_index, element) => {
      const src = absolutize(baseUrl, $(element).attr('src') || $(element).attr('data-src'));
      if (!src) return null;
      return {
        src,
        alt: cleanText($(element).attr('alt') || '') || undefined,
      };
    })
    .get()
    .filter(Boolean)
    .slice(0, 100) as Array<{ src: string; alt?: string }>;

  $('script,style,noscript,svg,canvas').remove();
  const text = cleanText($('main').text() || $('body').text());
  const wordCount = text ? text.split(/\s+/).filter(Boolean).length : 0;
  const faqCount =
    $('details summary').length +
    $('h2,h3,h4,p,strong')
      .map((_index, element) => cleanText($(element).text()))
      .get()
      .filter((item) => item.endsWith('?') && item.length > 8 && item.length < 180).length;

  const ctaCount = $('a,button')
    .map((_index, element) => cleanText($(element).text()))
    .get()
    .filter((item) => CTA_PATTERN.test(item)).length;

  return {
    url,
    finalUrl,
    statusCode: response.status,
    responseTimeMs,
    headers,
    title: cleanText($('title').first().text()) || undefined,
    metaDescription:
      cleanText($('meta[name="description"]').attr('content') || '') || undefined,
    canonical: absolutize(baseUrl, $('link[rel="canonical"]').attr('href')) || undefined,
    headings: { h1, h2, h3 },
    text,
    wordCount,
    links,
    images,
    schemaTypes,
    faqCount,
    ctaCount,
    hasContactForm: FORM_PATTERN.test(body),
    hasPhone: PHONE_PATTERN.test(text) || links.some((link) => link.startsWith('tel:')),
    hasWhatsapp: WHATSAPP_PATTERN.test(body),
    hasAppointment: APPOINTMENT_PATTERN.test(text) || APPOINTMENT_PATTERN.test(body),
    hasReviews: REVIEW_PATTERN.test(text) || schemaTypes.some((type) => /review|rating/i.test(type)),
    hasTestimonials: /(testimonial|ervaring|klanten zeggen|review)/i.test(rawHtml),
    hasGoogleMaps: /(google\.com\/maps|maps\.googleapis|google maps)/i.test(body),
    hasAnalytics: /(gtag\(|google-analytics|googletagmanager|G-[A-Z0-9]{6,})/i.test(body),
    hasRobotsTxt: false,
    hasSitemapXml: false,
  };
}

function selectInternalPages(homepage: CrawledPage, origin: string): string[] {
  const selected = new Set<string>();
  const preferred = /(contact|over|diensten|service|prijzen|blog|faq|review|ervaring)/i;
  for (const link of homepage.links) {
    try {
      const url = new URL(link);
      if (url.origin !== origin || selected.has(url.toString())) continue;
      if (preferred.test(url.pathname)) selected.add(url.toString());
      if (selected.size >= 5) break;
    } catch {
      // Ignore invalid links discovered in HTML.
    }
  }
  return Array.from(selected);
}

export class WebsiteCrawlService {
  async crawl(rawUrl: string): Promise<CrawlBundle> {
    const normalized = normalizeInputUrl(rawUrl);
    const homepage = await fetchPage(normalized.toString());
    const final = new URL(homepage.finalUrl);
    const parsedDomain = parseDomain(final.hostname);
    const domain = parsedDomain.domain || final.hostname;
    const robotsUrl = new URL('/robots.txt', final.origin);
    const sitemapUrl = new URL('/sitemap.xml', final.origin);
    const [robotsAvailable, sitemapAvailable, spfPresent, dmarcPresent] =
      await Promise.all([
        urlAvailable(robotsUrl),
        urlAvailable(sitemapUrl),
        txtContains(domain, /^v=spf1/i),
        txtContains(`_dmarc.${domain}`, /^v=DMARC1/i),
      ]);

    const pageUrls = selectInternalPages(homepage, final.origin);
    const pages = [homepage];
    for (const pageUrl of pageUrls) {
      try {
        pages.push(await fetchPage(pageUrl));
      } catch {
        // Optional secondary pages should not fail the full audit.
      }
    }

    homepage.hasRobotsTxt = robotsAvailable;
    homepage.hasSitemapXml = sitemapAvailable;

    return {
      requestedUrl: rawUrl,
      normalizedUrl: normalized.toString(),
      host: final.hostname,
      domain,
      homepage,
      pages,
      robotsAvailable,
      sitemapAvailable,
      spfPresent,
      dmarcPresent,
    };
  }

  hasLocalSignals(bundle: CrawlBundle): boolean {
    return bundle.pages.some((page) => LOCAL_LOCATION_PATTERN.test(page.text));
  }
}
