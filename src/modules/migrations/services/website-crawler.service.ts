import crypto from 'node:crypto';
import axios from 'axios';
import * as cheerio from 'cheerio';
import type {
  ExtractedCta,
  ExtractedFaq,
  ExtractedImage,
  ExtractedSection,
  ExtractedTestimonial,
  MigrationPageRecord,
} from '../types/migration.types';
import { migrationChildSk, migrationPk } from '../repositories/migration.repository';

type CrawlResult = {
  pages: MigrationPageRecord[];
  images: ExtractedImage[];
};

type CrawlOptions = {
  tenantId: string;
  migrationId: string;
  actorId: string;
  sourceUrl: string;
  maxPages?: number;
};

const CTA_PATTERN =
  /(contact|afspraak|plan|boek|bel|offerte|gratis|start|aanmelden|inschrijven|whatsapp|advies|kennismaking)/i;

const TESTIMONIAL_PATTERN =
  /(review|reviews|referentie|referenties|ervaring|ervaringen|klant|klanten vertellen|testimonial)/i;

function normalizeUrl(rawUrl: string): URL {
  const trimmed = String(rawUrl || '').trim();
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return new URL(withProtocol);
}

function stableId(value: string): string {
  return crypto.createHash('sha1').update(value).digest('hex').slice(0, 16);
}

function cleanText(value: string): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\u00a0/g, ' ')
    .trim();
}

function absolutize(baseUrl: URL, maybeUrl?: string): string | undefined {
  if (!maybeUrl) return undefined;
  const trimmed = maybeUrl.trim();
  if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('javascript:')) {
    return undefined;
  }
  try {
    return new URL(trimmed, baseUrl).toString();
  } catch {
    return undefined;
  }
}

function isLikelyAsset(url: URL): boolean {
  return /\.(pdf|zip|rar|7z|jpg|jpeg|png|gif|webp|svg|mp4|mp3|avi|mov|css|js|json|xml)$/i.test(
    url.pathname,
  );
}

function pageTypeFromPath(pathname: string): string {
  const path = pathname.toLowerCase();
  if (path === '/' || path === '') return 'home';
  if (path.includes('contact')) return 'contact';
  if (path.includes('tarief') || path.includes('prijs')) return 'pricing';
  if (path.includes('over')) return 'about';
  if (path.includes('blog') || path.includes('nieuws')) return 'content';
  if (path.includes('dienst') || path.includes('service') || path.includes('behandeling')) {
    return 'service';
  }
  return 'page';
}

function extractSections($: cheerio.CheerioAPI): ExtractedSection[] {
  const sections: ExtractedSection[] = [];
  const seen = new Set<string>();

  $('section, article, main div, body > div').each((_index, element) => {
    const container = $(element);
    const heading = cleanText(container.find('h1,h2,h3').first().text());
    const body = cleanText(
      container
        .find('p,li')
        .map((_i, item) => cleanText($(item).text()))
        .get()
        .filter(Boolean)
        .slice(0, 8)
        .join(' '),
    );

    if (body.length < 45) return;
    const key = `${heading}::${body.slice(0, 140)}`;
    if (seen.has(key)) return;
    seen.add(key);
    sections.push({
      heading: heading || undefined,
      body: body.slice(0, 1400),
    });
  });

  return sections.slice(0, 18);
}

function extractFaqs($: cheerio.CheerioAPI): ExtractedFaq[] {
  const faqs: ExtractedFaq[] = [];
  const seen = new Set<string>();

  $('details').each((_index, element) => {
    const question = cleanText($(element).find('summary').first().text());
    const answer = cleanText($(element).text().replace(question, ''));
    if (!question) return;
    seen.add(question.toLowerCase());
    faqs.push({ question, answer: answer || undefined });
  });

  $('h2,h3,h4,strong,p').each((_index, element) => {
    const text = cleanText($(element).text());
    if (!text.endsWith('?') || text.length < 8 || text.length > 180) return;
    const key = text.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const answer = cleanText($(element).next('p,div,span').text());
    faqs.push({ question: text, answer: answer || undefined });
  });

  return faqs.slice(0, 25);
}

function extractCtas($: cheerio.CheerioAPI, baseUrl: URL): ExtractedCta[] {
  const ctas: ExtractedCta[] = [];
  const seen = new Set<string>();

  $('a,button').each((_index, element) => {
    const label = cleanText($(element).text());
    if (!label || label.length > 80 || !CTA_PATTERN.test(label)) return;
    const href = absolutize(baseUrl, $(element).attr('href'));
    const key = `${label.toLowerCase()}::${href || ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    ctas.push({ label, href, context: cleanText($(element).parent().text()).slice(0, 180) });
  });

  return ctas.slice(0, 20);
}

function extractTestimonials($: cheerio.CheerioAPI): ExtractedTestimonial[] {
  const testimonials: ExtractedTestimonial[] = [];
  const seen = new Set<string>();

  $('blockquote, [class*="review"], [class*="testimonial"], [class*="referentie"]').each(
    (_index, element) => {
      const quote = cleanText($(element).text());
      if (quote.length < 40 || quote.length > 900) return;
      const key = quote.toLowerCase().slice(0, 120);
      if (seen.has(key)) return;
      seen.add(key);
      testimonials.push({ quote });
    },
  );

  $('section, article, div').each((_index, element) => {
    const label = `${$(element).attr('class') || ''} ${$(element).attr('id') || ''} ${cleanText(
      $(element).find('h2,h3').first().text(),
    )}`;
    if (!TESTIMONIAL_PATTERN.test(label)) return;
    const quote = cleanText($(element).find('p').first().text());
    if (quote.length < 40 || quote.length > 900) return;
    const key = quote.toLowerCase().slice(0, 120);
    if (seen.has(key)) return;
    seen.add(key);
    testimonials.push({ quote });
  });

  return testimonials.slice(0, 20);
}

function scoreSeo(input: {
  title?: string;
  description?: string;
  h1?: string;
  wordCount: number;
  images: ExtractedImage[];
  canonicalUrl?: string;
}): number {
  let score = 0;
  if (input.title && input.title.length >= 25 && input.title.length <= 65) score += 22;
  else if (input.title) score += 12;
  if (
    input.description &&
    input.description.length >= 90 &&
    input.description.length <= 170
  ) {
    score += 22;
  } else if (input.description) {
    score += 12;
  }
  if (input.h1) score += 18;
  if (input.wordCount >= 450) score += 18;
  else if (input.wordCount >= 220) score += 10;
  if (input.images.length === 0 || input.images.every((image) => image.altText)) {
    score += 12;
  } else if (input.images.some((image) => image.altText)) {
    score += 6;
  }
  if (input.canonicalUrl) score += 8;
  return Math.min(100, score);
}

function contentCoverage(input: {
  sections: ExtractedSection[];
  faqs: ExtractedFaq[];
  ctas: ExtractedCta[];
  testimonials: ExtractedTestimonial[];
  seoScore: number;
}): { score: number; missing: string[] } {
  const missing: string[] = [];
  let score = 20;
  if (input.sections.length >= 5) score += 25;
  else missing.push('Voldoende inhoudelijke secties');
  if (input.ctas.length >= 1) score += 20;
  else missing.push('CTA blok');
  if (input.faqs.length >= 3) score += 15;
  else missing.push('FAQ');
  if (input.testimonials.length >= 1) score += 10;
  else missing.push('Testimonials');
  if (input.seoScore >= 70) score += 10;
  else missing.push('SEO metadata');
  return { score: Math.min(100, score), missing };
}

export class WebsiteCrawlerService {
  async crawl(options: CrawlOptions): Promise<CrawlResult> {
    const startUrl = normalizeUrl(options.sourceUrl);
    const origin = startUrl.origin;
    const maxPages = Math.max(1, Math.min(options.maxPages || 18, 40));
    const queue = [startUrl.toString()];
    const visited = new Set<string>();
    const discovered = new Set<string>(queue);
    const pages: MigrationPageRecord[] = [];
    const imageMap = new Map<string, ExtractedImage>();

    while (queue.length > 0 && pages.length < maxPages) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      const response = await axios.get<string>(current, {
        timeout: 15000,
        responseType: 'text',
        maxRedirects: 5,
        headers: {
          'User-Agent':
            'VedantixWebsiteMigrator/1.0 (+https://vedantix.nl; content migration crawler)',
          Accept: 'text/html,application/xhtml+xml',
        },
        validateStatus: (status) => status >= 200 && status < 400,
      });

      const contentType = String(response.headers['content-type'] || '');
      if (!contentType.includes('html') && !String(response.data).includes('<html')) {
        continue;
      }

      const pageUrl = new URL(response.request?.res?.responseUrl || current);
      const $ = cheerio.load(response.data);
      $('script,style,noscript,svg,canvas,iframe').remove();

      $('a[href]').each((_index, element) => {
        const href = absolutize(pageUrl, $(element).attr('href'));
        if (!href) return;
        const nextUrl = new URL(href);
        nextUrl.hash = '';
        if (nextUrl.origin !== origin || isLikelyAsset(nextUrl)) return;
        const normalized = nextUrl.toString();
        if (discovered.has(normalized) || visited.has(normalized)) return;
        discovered.add(normalized);
        queue.push(normalized);
      });

      const title = cleanText($('title').first().text());
      const description = cleanText($('meta[name="description"]').attr('content') || '');
      const canonicalUrl = absolutize(pageUrl, $('link[rel="canonical"]').attr('href'));
      const h1 = cleanText($('h1').first().text());
      const headings = $('h1,h2,h3')
        .map((_index, element) => cleanText($(element).text()))
        .get()
        .filter(Boolean)
        .slice(0, 40);
      const text = cleanText($('main').text() || $('body').text());
      const wordCount = text ? text.split(/\s+/).filter(Boolean).length : 0;
      const sections = extractSections($);
      const images = $('img')
        .map((_index, element) => {
          const imageUrl = absolutize(
            pageUrl,
            $(element).attr('src') || $(element).attr('data-src'),
          );
          if (!imageUrl) return null;
          return {
            imageUrl,
            altText: cleanText($(element).attr('alt') || '') || undefined,
            sourcePageUrl: pageUrl.toString(),
          } satisfies ExtractedImage;
        })
        .get()
        .filter(Boolean)
        .slice(0, 80) as ExtractedImage[];

      for (const image of images) {
        if (!imageMap.has(image.imageUrl)) imageMap.set(image.imageUrl, image);
      }

      const faqs = extractFaqs($);
      const ctas = extractCtas($, pageUrl);
      const testimonials = extractTestimonials($);
      const seoScore = scoreSeo({
        title,
        description,
        h1,
        wordCount,
        images,
        canonicalUrl,
      });
      const coverage = contentCoverage({
        sections,
        faqs,
        ctas,
        testimonials,
        seoScore,
      });
      const pageId = stableId(pageUrl.toString());
      const now = new Date().toISOString();

      pages.push({
        pk: migrationPk(options.tenantId),
        sk: migrationChildSk(options.migrationId, 'PAGE', pageId),
        entityType: 'PAGE',
        tenantId: options.tenantId,
        migrationId: options.migrationId,
        pageId,
        pageUrl: pageUrl.toString(),
        pathname: pageUrl.pathname || '/',
        pageType: pageTypeFromPath(pageUrl.pathname),
        title: title || undefined,
        description: description || undefined,
        canonicalUrl,
        h1: h1 || undefined,
        headings,
        wordCount,
        sections,
        images,
        faqs,
        ctas,
        testimonials,
        seoScore,
        contentCoverage: coverage.score,
        missingContent: coverage.missing,
        createdAt: now,
        updatedAt: now,
        createdBy: options.actorId,
        updatedBy: options.actorId,
      });
    }

    return {
      pages,
      images: Array.from(imageMap.values()),
    };
  }
}
