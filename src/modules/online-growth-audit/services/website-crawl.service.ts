import dns from 'node:dns/promises';
import fs from 'node:fs';
import net from 'node:net';
import axios from 'axios';
import * as cheerio from 'cheerio';
import puppeteer, { type Browser, type HTTPResponse, type Page } from 'puppeteer-core';
import { parse as parseDomain } from 'tldts';
import { BadRequestError } from '../../../errors/app-error';
import type { CrawlBundle, CrawledPage } from '../types/online-growth-audit.types';

const USER_AGENT = 'VedantixOnlineGrowthAudit/3.0 (+https://vedantix.nl/online-groei-audit)';
const MAX_PAGES = 8;
const REQUEST_TIMEOUT_MS = 30_000;
const RENDERED_CONTENT_TIMEOUT_MS = 12_000;
const TARGET_RENDERED_WORDS = 30;
const MINIMUM_RENDERED_WORDS = 8;
const MAX_RESPONSE_BYTES = 4_000_000;
const CTA_PATTERN =
  /\b(contact|afspraak|plan|boek|bel|offerte|gratis|start|aanvragen|whatsapp|advies|kennismaking|proefles|intake|demo|bestel|reserveer)\b/i;
const PHONE_PATTERN = /(?:\+31|0031|0)\s?[1-9](?:[\s().-]*\d){7,9}/;
const WHATSAPP_PATTERN = /(wa\.me|whatsapp|api\.whatsapp\.com)/i;
const APPOINTMENT_PATTERN = /(calendly|afspraak|booking|book|plan|reserver|intake|proefles)/i;
const REVIEW_PLATFORM_PATTERN = /(google\.[^/]+\/maps|g\.page|trustpilot|klantenvertellen|feedbackcompany)/i;
const REVIEW_ELEMENT_PATTERN = /(review|reviews|testimonial|testimonials|beoordeling|ervaringen|klanten-zeggen)/i;
const LOCAL_LOCATION_PATTERN =
  /\b(den bosch|eindhoven|tilburg|breda|nijmegen|amsterdam|rotterdam|utrecht|plaats|regio|omgeving|lokaal|werkgebied)\b/i;
const ANALYTICS_PROVIDERS: Array<[string, RegExp]> = [
  ['Google Analytics 4', /(googletagmanager\.com\/gtag\/js|gtag\(|G-[A-Z0-9]{6,})/i],
  ['Google Tag Manager', /(googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]+)/i],
  ['Matomo', /(matomo\.js|_paq\.push)/i],
  ['Plausible', /plausible\.io\/js/i],
  ['Microsoft Clarity', /(clarity\.ms|clarity\()/i],
];

export type RawPage = {
  requestedUrl: string;
  finalUrl: string;
  statusCode: number;
  responseTimeMs: number;
  headers: Record<string, string>;
  html: string;
  renderMode: CrawledPage['renderMode'];
};

function cleanText(value: string): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\u00a0/g, ' ')
    .trim();
}

function normalizeInputUrl(rawUrl: string): URL {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) throw new BadRequestError('Website URL is verplicht.');

  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Unsupported protocol');
    url.username = '';
    url.password = '';
    url.hash = '';
    return url;
  } catch {
    throw new BadRequestError('Website URL is geen geldige publieke URL.');
  }
}

function isPrivateAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }

  if (net.isIPv6(address)) {
    const normalized = address.toLowerCase();
    if (normalized.startsWith('::ffff:')) return isPrivateAddress(normalized.slice(7));
    return (
      normalized === '::' ||
      normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      /^fe[89ab]/.test(normalized) ||
      normalized.startsWith('ff')
    );
  }

  return true;
}

async function assertPublicUrl(url: URL): Promise<void> {
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new BadRequestError('Alleen publiek bereikbare websites kunnen worden geanalyseerd.');
  }

  if (net.isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      throw new BadRequestError('Privé- en interne netwerkadressen zijn niet toegestaan.');
    }
    return;
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch {
    throw new BadRequestError('Het domein kon niet via DNS worden gevonden.');
  }
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new BadRequestError('Het domein verwijst niet uitsluitend naar publieke netwerkadressen.');
  }
}

function absolutize(baseUrl: URL, maybeUrl?: string): string | null {
  if (!maybeUrl) return null;
  const trimmed = maybeUrl.trim();
  if (!trimmed || /^(data|javascript|blob):/i.test(trimmed)) return null;
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

function extractSchema($: cheerio.CheerioAPI): {
  types: string[];
  invalidCount: number;
  faqCount: number;
} {
  const types = new Set<string>();
  let invalidCount = 0;
  let faqCount = 0;

  $('script[type="application/ld+json"]').each((_index, element) => {
    const raw = $(element).contents().text();
    try {
      const parsed = JSON.parse(raw);
      const nodes = Array.isArray(parsed) ? parsed : [parsed];
      const stack = [...nodes];
      while (stack.length) {
        const current = stack.shift();
        if (!current || typeof current !== 'object') continue;
        const record = current as Record<string, unknown>;
        const type = record['@type'];
        if (Array.isArray(type)) type.forEach((item) => types.add(String(item)));
        else if (type) types.add(String(type));
        if (
          (type === 'FAQPage' || (Array.isArray(type) && type.includes('FAQPage'))) &&
          Array.isArray(record.mainEntity)
        ) {
          faqCount += record.mainEntity.length;
        }
        const graph = record['@graph'];
        if (Array.isArray(graph)) stack.push(...graph);
      }
    } catch {
      invalidCount += 1;
    }
  });

  return { types: Array.from(types), invalidCount, faqCount };
}

function isLikelyHtml(contentType: string, body: string): boolean {
  return contentType.includes('html') || /<html|<!doctype/i.test(body);
}

async function fetchPublicText(rawUrl: string, timeout = REQUEST_TIMEOUT_MS): Promise<RawPage> {
  let current = normalizeInputUrl(rawUrl);
  const startedAt = Date.now();

  for (let redirect = 0; redirect <= 5; redirect += 1) {
    await assertPublicUrl(current);
    const response = await axios.get<string>(current.toString(), {
      timeout,
      maxRedirects: 0,
      responseType: 'text',
      maxContentLength: MAX_RESPONSE_BYTES,
      maxBodyLength: MAX_RESPONSE_BYTES,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml,text/xml;q=0.9,*/*;q=0.7',
      },
      validateStatus: (status) => status >= 200 && status < 500,
    });
    const headers = headerMap(response.headers as Record<string, unknown>);

    if (response.status >= 300 && response.status < 400 && headers.location) {
      current = new URL(headers.location, current);
      if (!['http:', 'https:'].includes(current.protocol)) {
        throw new BadRequestError('Website verwijst door naar een niet-ondersteund protocol.');
      }
      continue;
    }

    return {
      requestedUrl: rawUrl,
      finalUrl: current.toString(),
      statusCode: response.status,
      responseTimeMs: Date.now() - startedAt,
      headers,
      html: String(response.data || ''),
      renderMode: 'STATIC_HTML',
    };
  }

  throw new BadRequestError('Website verwijst te vaak door.');
}

export function parsePage(raw: RawPage): CrawledPage {
  if (!isLikelyHtml(raw.headers['content-type'] || '', raw.html)) {
    throw new BadRequestError('Website URL levert geen HTML-pagina op.');
  }

  const $ = cheerio.load(raw.html);
  const baseUrl = new URL(raw.finalUrl);
  const schema = extractSchema($);
  const headings = (selector: string, limit: number) =>
    $(selector)
      .map((_index, element) => cleanText($(element).text()))
      .get()
      .filter(Boolean)
      .slice(0, limit);
  const links = $('a[href]')
    .map((_index, element) => absolutize(baseUrl, $(element).attr('href')))
    .get()
    .filter(Boolean)
    .slice(0, 300) as string[];
  const images = $('img')
    .map((_index, element) => {
      const src = absolutize(baseUrl, $(element).attr('src') || $(element).attr('data-src'));
      if (!src) return null;
      return { src, alt: cleanText($(element).attr('alt') || '') || undefined };
    })
    .get()
    .filter(Boolean)
    .slice(0, 160) as Array<{ src: string; alt?: string }>;

  const analyticsProviders = ANALYTICS_PROVIDERS
    .filter(([, matcher]) => matcher.test(raw.html))
    .map(([name]) => name);
  const reviewElements = $('[class],[id],blockquote')
    .filter((_index, element) => {
      const marker = `${$(element).attr('class') || ''} ${$(element).attr('id') || ''}`;
      return REVIEW_ELEMENT_PATTERN.test(marker);
    });
  const reviewText = cleanText(reviewElements.text());
  const hasReviewSchema = schema.types.some((type) => /Review|AggregateRating/i.test(type));
  const questionTexts = $('details summary,h2,h3,h4,[class*="faq"] button,[class*="accordion"] button')
    .map((_index, element) => cleanText($(element).text()))
    .get()
    .filter((item) => item.endsWith('?') && item.length >= 8 && item.length <= 220);
  const faqCount = Math.max(new Set(questionTexts).size, schema.faqCount);
  const ctaTexts = $('a,button,input[type="submit"]')
    .map((_index, element) => cleanText($(element).text() || $(element).attr('value') || ''))
    .get()
    .filter((item) => CTA_PATTERN.test(item));

  $('script,style,noscript,svg,canvas,template').remove();
  const text = cleanText($('main').text() || $('body').text());
  const wordCount = text ? text.split(/\s+/).filter(Boolean).length : 0;
  const hasEmail = /mailto:/i.test(raw.html) || /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(text);
  const hasAddress = $('address').length > 0 || /\b\d{4}\s?[A-Z]{2}\b/.test(text);
  const hasLegalLinks = links.some((link) => /privacy|voorwaarden|cookies|disclaimer/i.test(link));
  const hasSocialLinks = links.some((link) => /linkedin|facebook|instagram|youtube|tiktok|x\.com/i.test(link));
  const hasReviewPlatformLink = links.some((link) => REVIEW_PLATFORM_PATTERN.test(link));

  return {
    url: raw.requestedUrl,
    finalUrl: raw.finalUrl,
    statusCode: raw.statusCode,
    responseTimeMs: raw.responseTimeMs,
    bodyBytes: Buffer.byteLength(raw.html),
    renderMode: raw.renderMode,
    headers: raw.headers,
    title: cleanText($('title').first().text()) || undefined,
    metaDescription: cleanText($('meta[name="description"]').attr('content') || '') || undefined,
    canonical: absolutize(baseUrl, $('link[rel="canonical"]').attr('href')) || undefined,
    headings: {
      h1: headings('h1', 20),
      h2: headings('h2', 60),
      h3: headings('h3', 80),
    },
    text,
    wordCount,
    links,
    images,
    schemaTypes: schema.types,
    invalidSchemaCount: schema.invalidCount,
    faqSchemaCount: schema.faqCount,
    hasNoindex: /\bnoindex\b/i.test($('meta[name="robots"]').attr('content') || ''),
    faqCount,
    ctaCount: Math.min(40, new Set(ctaTexts).size),
    hasContactForm: $('form').filter((_index, element) => $(element).find('input,textarea,select').length > 0).length > 0,
    hasPhone: PHONE_PATTERN.test(text) || links.some((link) => link.startsWith('tel:')),
    hasWhatsapp: WHATSAPP_PATTERN.test(raw.html),
    hasAppointment: links.some((link) => APPOINTMENT_PATTERN.test(link)) || ctaTexts.some((textValue) => APPOINTMENT_PATTERN.test(textValue)),
    hasReviews: hasReviewSchema || reviewElements.length > 0 || hasReviewPlatformLink,
    hasTestimonials: reviewElements.length > 0,
    hasGoogleMaps: /(google\.[^"']+\/maps|maps\.googleapis|maps\.app\.goo\.gl|google maps)/i.test(raw.html),
    hasAnalytics: analyticsProviders.length > 0,
    analyticsProviders,
    hasAddress,
    hasEmail,
    hasLegalLinks,
    hasSocialLinks,
    hasReviewPlatformLink,
    hasNamedTestimonials: reviewText.length >= 80 && /[“”"']|\b[A-Z][a-z]+\s[A-Z][a-z]+\b/.test(reviewText),
    hasRobotsTxt: false,
    hasSitemapXml: false,
  };
}

function chromiumExecutable(): string | null {
  const candidates = [
    process.env.CHROMIUM_EXECUTABLE_PATH,
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome-stable',
  ].filter(Boolean) as string[];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

async function configureSafePage(page: Page): Promise<void> {
  const hostSafety = new Map<string, Promise<boolean>>();
  await page.setUserAgent(USER_AGENT);
  await page.setRequestInterception(true);
  page.on('request', async (request) => {
    try {
      const resourceType = request.resourceType();
      if (['image', 'font', 'media'].includes(resourceType)) {
        await request.abort();
        return;
      }
      const requestUrl = new URL(request.url());
      if (!['http:', 'https:'].includes(requestUrl.protocol)) {
        if (['data:', 'blob:'].includes(requestUrl.protocol)) await request.continue();
        else await request.abort();
        return;
      }
      const hostname = requestUrl.hostname.toLowerCase();
      if (!hostSafety.has(hostname)) {
        hostSafety.set(
          hostname,
          assertPublicUrl(requestUrl).then(() => true).catch(() => false),
        );
      }
      if (await hostSafety.get(hostname)) await request.continue();
      else await request.abort();
    } catch {
      try {
        await request.abort();
      } catch {
        // Request was already handled by Chromium.
      }
    }
  });
}

async function renderPage(browser: Browser, rawUrl: string): Promise<RawPage> {
  const url = normalizeInputUrl(rawUrl);
  await assertPublicUrl(url);
  const page = await browser.newPage();
  await configureSafePage(page);
  const startedAt = Date.now();
  let response: HTTPResponse | null = null;
  try {
    response = await page.goto(url.toString(), {
      waitUntil: 'domcontentloaded',
      timeout: REQUEST_TIMEOUT_MS,
    });
    await Promise.all([
      page.waitForNetworkIdle({ idleTime: 700, timeout: 8000 }).catch(() => undefined),
      page
        .waitForFunction(
          (minimumWords) => {
            const contentRoot =
              document.querySelector('main') ||
              document.querySelector('#root') ||
              document.querySelector('#app') ||
              document.body;
            const text = String((contentRoot as HTMLElement | null)?.innerText || '')
              .replace(/\s+/g, ' ')
              .trim();
            return text ? text.split(/\s+/).length >= minimumWords : false;
          },
          { timeout: RENDERED_CONTENT_TIMEOUT_MS },
          TARGET_RENDERED_WORDS,
        )
        .catch(() => undefined),
    ]);
    const finalUrl = page.url();
    await assertPublicUrl(new URL(finalUrl));
    const html = await page.content();
    const rendered = parsePage({
      requestedUrl: rawUrl,
      finalUrl,
      statusCode: response?.status() ?? 200,
      responseTimeMs: Date.now() - startedAt,
      headers: response?.headers() ?? {},
      html,
      renderMode: 'BROWSER_RENDERED',
    });
    if (rendered.wordCount < MINIMUM_RENDERED_WORDS) {
      throw new Error(
        `JavaScript-rendering leverde slechts ${rendered.wordCount} zichtbare woorden op.`,
      );
    }
    return {
      requestedUrl: rawUrl,
      finalUrl,
      statusCode: response?.status() ?? 200,
      responseTimeMs: Date.now() - startedAt,
      headers: response?.headers() ?? {},
      html,
      renderMode: 'BROWSER_RENDERED',
    };
  } finally {
    await page.close();
  }
}

function looksClientRendered(raw: RawPage): boolean {
  const $ = cheerio.load(raw.html);
  $('script,style,noscript,svg,template').remove();
  const visibleText = cleanText($('main').text() || $('body').text());
  const hasAppRoot = $('[id="root"],[id="app"],[data-reactroot],script[src]').length > 0;
  return visibleText.split(/\s+/).filter(Boolean).length < 220 && hasAppRoot;
}

async function readAvailability(
  url: URL,
  validateBody: (body: string, headers: Record<string, string>) => boolean,
): Promise<{ available: boolean; body: string }> {
  try {
    const response = await fetchPublicText(url.toString(), 8000);
    return {
      available: response.statusCode >= 200 && response.statusCode < 400 && validateBody(response.html, response.headers),
      body: response.html,
    };
  } catch {
    return { available: false, body: '' };
  }
}

async function txtContains(domain: string, pattern: RegExp): Promise<boolean> {
  try {
    const records = await dns.resolveTxt(domain);
    return records.some((record) => pattern.test(record.join('')));
  } catch {
    return false;
  }
}

function sitemapUrls(body: string, origin: string): string[] {
  const urls = new Set<string>();
  const matcher = /<loc>\s*([^<]+?)\s*<\/loc>/gi;
  for (const match of body.matchAll(matcher)) {
    try {
      const url = new URL(match[1].replace(/&amp;/g, '&').trim());
      if (url.origin === origin && /^https?:$/.test(url.protocol)) {
        url.hash = '';
        urls.add(url.toString());
      }
    } catch {
      // Ignore malformed sitemap entries.
    }
  }
  return Array.from(urls);
}

async function collectSitemapPageUrls(body: string, origin: string): Promise<string[]> {
  const direct = sitemapUrls(body, origin);
  if (!/<sitemapindex\b/i.test(body)) return direct;

  const pages = new Set<string>();
  for (const nestedUrl of direct.slice(0, 5)) {
    try {
      const nested = await readAvailability(
        new URL(nestedUrl),
        (nestedBody) => /<(urlset|sitemapindex)\b/i.test(nestedBody),
      );
      if (!nested.available) continue;
      sitemapUrls(nested.body, origin).forEach((url) => {
        if (!/\.xml(?:$|\?)/i.test(url)) pages.add(url);
      });
    } catch {
      // A broken child sitemap should not invalidate the other sitemap data.
    }
  }
  return Array.from(pages);
}

function pagePriority(url: URL): number {
  const path = url.pathname.toLowerCase();
  const patterns: Array<[RegExp, number]> = [
    [/^\/$/, 100],
    [/contact|afspraak|offerte/, 90],
    [/over-ons|over-mij|team|about/, 85],
    [/dienst|service|oplossing|aanbod/, 80],
    [/prijzen|tarief|kosten/, 75],
    [/faq|veelgestelde/, 70],
    [/review|ervaring|resultaat|case|portfolio/, 65],
    [/blog|kennis|nieuws|artikel/, 60],
  ];
  return patterns.find(([pattern]) => pattern.test(path))?.[1] ?? 20;
}

function selectInternalPages(homepage: CrawledPage, sitemap: string[], origin: string): string[] {
  const candidates = new Map<string, number>();
  for (const rawUrl of [...homepage.links, ...sitemap]) {
    try {
      const url = new URL(rawUrl);
      if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol)) continue;
      if (/\.(pdf|jpe?g|png|webp|svg|zip|xml|txt)$/i.test(url.pathname)) continue;
      url.hash = '';
      url.search = '';
      const normalized = url.toString();
      if (normalized === homepage.finalUrl) continue;
      candidates.set(normalized, Math.max(candidates.get(normalized) ?? 0, pagePriority(url)));
    } catch {
      // Ignore malformed discovered URLs.
    }
  }
  return Array.from(candidates)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_PAGES - 1)
    .map(([url]) => url);
}

export class WebsiteCrawlService {
  async validatePublicUrl(rawUrl: string): Promise<string> {
    const normalized = normalizeInputUrl(rawUrl);
    await assertPublicUrl(normalized);
    return normalized.toString();
  }

  async crawl(rawUrl: string): Promise<CrawlBundle> {
    const normalized = normalizeInputUrl(rawUrl);
    await assertPublicUrl(normalized);
    const warnings: string[] = [];
    const executablePath = chromiumExecutable();
    let browser: Browser | null = null;
    let homepageRaw = await fetchPublicText(normalized.toString());

    if (executablePath) {
      try {
        browser = await puppeteer.launch({
          executablePath,
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        });
        homepageRaw = await renderPage(browser, normalized.toString());
      } catch (error) {
        warnings.push(`Browserweergave van de homepage mislukte: ${error instanceof Error ? error.message : 'onbekende fout'}`);
        homepageRaw.renderMode = 'STATIC_FALLBACK';
      }
    } else if (looksClientRendered(homepageRaw)) {
      warnings.push('De site lijkt JavaScript-gestuurd, maar browserweergave is niet beschikbaar; zichtbare content kan onvolledig zijn.');
      homepageRaw.renderMode = 'STATIC_FALLBACK';
    }

    try {
      if (homepageRaw.statusCode < 200 || homepageRaw.statusCode >= 400) {
        throw new BadRequestError(`De homepage gaf HTTP ${homepageRaw.statusCode}; controleer de URL en bereikbaarheid.`);
      }
      const homepage = parsePage(homepageRaw);
      if (homepage.wordCount < 80) {
        warnings.push(`De homepage leverde slechts ${homepage.wordCount} zichtbare woorden op; contentmetingen hebben daardoor minder vertrouwen.`);
      }
      const final = new URL(homepage.finalUrl);
      const parsedDomain = parseDomain(final.hostname);
      const domain = parsedDomain.domain || final.hostname;
      const robotsUrl = new URL('/robots.txt', final.origin);
      const sitemapUrl = new URL('/sitemap.xml', final.origin);
      const llmsUrl = new URL('/llms.txt', final.origin);
      const [robots, sitemap, llmsTxt, spfPresent, dmarcPresent] = await Promise.all([
        readAvailability(robotsUrl, (body) => /(^|\n)\s*user-agent\s*:/i.test(body)),
        readAvailability(sitemapUrl, (body) => /<(urlset|sitemapindex)\b/i.test(body)),
        readAvailability(llmsUrl, (body, headers) => !isLikelyHtml(headers['content-type'] || '', body) && cleanText(body).length >= 20),
        txtContains(domain, /^v=spf1\b/i),
        txtContains(`_dmarc.${domain}`, /^v=DMARC1\b/i),
      ]);
      const discoveredSitemapUrls = sitemap.available
        ? await collectSitemapPageUrls(sitemap.body, final.origin)
        : [];
      const pageUrls = selectInternalPages(homepage, discoveredSitemapUrls, final.origin);
      const pages = [homepage];

      for (const pageUrl of pageUrls) {
        try {
          let rawPage = await fetchPublicText(pageUrl);
          if (browser) {
            try {
              rawPage = await renderPage(browser, pageUrl);
            } catch (error) {
              rawPage.renderMode = 'STATIC_FALLBACK';
              warnings.push(`Browserweergave overgeslagen voor ${new URL(pageUrl).pathname}: ${error instanceof Error ? error.message : 'onbekende fout'}`);
            }
          } else if (looksClientRendered(rawPage)) {
            rawPage.renderMode = 'STATIC_FALLBACK';
          }
          const parsedPage = parsePage(rawPage);
          if (parsedPage.statusCode >= 200 && parsedPage.statusCode < 400) pages.push(parsedPage);
          else warnings.push(`${new URL(pageUrl).pathname} gaf HTTP ${parsedPage.statusCode}.`);
        } catch (error) {
          warnings.push(`${new URL(pageUrl).pathname} kon niet worden geanalyseerd: ${error instanceof Error ? error.message : 'onbekende fout'}`);
        }
      }

      homepage.hasRobotsTxt = robots.available;
      homepage.hasSitemapXml = sitemap.available;

      return {
        requestedUrl: rawUrl,
        normalizedUrl: normalized.toString(),
        host: final.hostname,
        domain,
        homepage,
        pages,
        robotsAvailable: robots.available,
        sitemapAvailable: sitemap.available,
        sitemapUrlCount: discoveredSitemapUrls.length,
        llmsTxtAvailable: llmsTxt.available,
        spfPresent,
        dmarcPresent,
        crawlWarnings: warnings.slice(0, 12),
        pagesAttempted: 1 + pageUrls.length,
      };
    } finally {
      await browser?.close();
    }
  }

  hasLocalSignals(bundle: CrawlBundle): boolean {
    return bundle.pages.some((page) => LOCAL_LOCATION_PATTERN.test(page.text));
  }
}
