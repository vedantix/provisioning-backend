import axios from 'axios';
import { env } from '../../../config/env';
import type {
  AuditCategoryKey,
  AuditScore,
  CrawlBundle,
  CrawledPage,
} from '../types/online-growth-audit.types';

type ScoreDraft = Omit<AuditScore, 'status'> & {
  score: number | null;
  status?: AuditScore['status'];
};

function clamp(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function completed(draft: ScoreDraft): AuditScore {
  return {
    ...draft,
    score: draft.score === null ? null : clamp(draft.score),
    status: draft.status ?? (draft.score === null ? 'UNKNOWN' : 'COMPLETED'),
    findings: draft.findings.slice(0, 8),
    recommendations: draft.recommendations.slice(0, 8),
  };
}

function hasSchema(page: CrawledPage, matcher: RegExp): boolean {
  return page.schemaTypes.some((type) => matcher.test(type));
}

function allText(bundle: CrawlBundle): string {
  return bundle.pages.map((page) => page.text).join(' ').toLowerCase();
}

function countPages(bundle: CrawlBundle, predicate: (page: CrawledPage) => boolean): number {
  return bundle.pages.filter(predicate).length;
}

function addIf(
  condition: boolean,
  points: number,
  findings: string[],
  recommendations: string[],
  positive: string,
  negative: string,
): number {
  if (condition) {
    findings.push(positive);
    return points;
  }
  recommendations.push(negative);
  return 0;
}

export class SEOAuditService {
  analyze(bundle: CrawlBundle): AuditScore {
    const page = bundle.homepage;
    const findings: string[] = [];
    const recommendations: string[] = [];
    let score = 0;

    score += addIf(
      Boolean(page.title && page.title.length >= 25 && page.title.length <= 70),
      18,
      findings,
      recommendations,
      'Title tag heeft een bruikbare lengte.',
      'Optimaliseer de title tag naar ongeveer 25 tot 70 tekens.',
    );
    score += addIf(
      Boolean(page.metaDescription && page.metaDescription.length >= 80 && page.metaDescription.length <= 170),
      18,
      findings,
      recommendations,
      'Meta description is aanwezig en bruikbaar.',
      'Schrijf een overtuigende meta description met dienst, regio en CTA.',
    );
    score += addIf(
      page.headings.h1.length === 1,
      14,
      findings,
      recommendations,
      'Er is precies één H1 aanwezig.',
      'Gebruik één duidelijke H1 die direct vertelt wat je doet.',
    );
    score += addIf(
      page.headings.h2.length >= 3,
      12,
      findings,
      recommendations,
      'De pagina heeft meerdere H2-koppen.',
      'Gebruik H2-koppen voor diensten, voordelen, reviews en contact.',
    );
    score += addIf(
      Boolean(page.canonical),
      10,
      findings,
      recommendations,
      'Canonical URL is aanwezig.',
      'Voeg een canonical URL toe om duplicate content te voorkomen.',
    );
    score += addIf(
      bundle.sitemapAvailable,
      10,
      findings,
      recommendations,
      'Sitemap.xml is bereikbaar.',
      'Publiceer een sitemap.xml en dien deze in bij Google Search Console.',
    );
    score += addIf(
      bundle.robotsAvailable,
      8,
      findings,
      recommendations,
      'Robots.txt is bereikbaar.',
      'Publiceer een robots.txt met verwijzing naar de sitemap.',
    );
    score += addIf(
      page.schemaTypes.length > 0,
      10,
      findings,
      recommendations,
      'Structured data is aanwezig.',
      'Voeg Organization, LocalBusiness, Service en FAQ schema toe.',
    );

    return completed({
      key: 'seo',
      label: 'SEO Audit',
      score,
      summary: 'Controle op metadata, headings, canonical, sitemap, robots en structured data.',
      findings,
      recommendations,
      evidence: {
        title: page.title,
        metaDescription: page.metaDescription,
        h1Count: page.headings.h1.length,
        schemaTypes: page.schemaTypes,
      },
    });
  }
}

export class GEOAuditService {
  analyze(bundle: CrawlBundle): AuditScore {
    const text = allText(bundle);
    const findings: string[] = [];
    const recommendations: string[] = [];
    let score = 10;

    score += addIf(/vedantix|bedrijf|organisatie|team|over ons|wie wij zijn/i.test(text), 18, findings, recommendations, 'Organisatie is herkenbaar in de content.', 'Maak duidelijk wie het bedrijf is en waarom het betrouwbaar is.');
    score += addIf(/diensten|service|aanbod|oplossingen|specialist/i.test(text), 16, findings, recommendations, 'Diensten worden expliciet benoemd.', 'Beschrijf diensten en oplossingen concreet per doelgroep.');
    score += addIf(bundle.pages.some((page) => page.hasPhone) || /@/.test(text), 14, findings, recommendations, 'Contactgegevens zijn herkenbaar.', 'Maak telefoonnummer, e-mailadres en contactroute duidelijk zichtbaar.');
    score += addIf(bundle.pages.some((page) => hasSchema(page, /Organization|LocalBusiness|Service/i)), 18, findings, recommendations, 'Entity schema helpt zoekmachines en AI-systemen.', 'Voeg Organization, LocalBusiness en Service schema toe.');
    score += addIf(/\b(den bosch|eindhoven|tilburg|breda|nijmegen|nederland|regio|lokaal)\b/i.test(text), 14, findings, recommendations, 'Locatie- of regio-informatie is aanwezig.', 'Noem de regio’s en plaatsen waar je actief bent.');
    score += addIf(bundle.pages.some((page) => page.faqCount > 0), 10, findings, recommendations, 'Vraag-antwoordcontent is aanwezig.', 'Voeg concrete klantvragen toe zodat AI-antwoorden je bedrijf beter kunnen citeren.');

    return completed({
      key: 'geo',
      label: 'GEO Audit',
      score,
      summary: 'Controleert of het bedrijf als duidelijke entiteit herkenbaar is voor generatieve zoekmachines.',
      findings,
      recommendations,
    });
  }
}

export class AEOAuditService {
  analyze(bundle: CrawlBundle): AuditScore {
    const faqCount = bundle.pages.reduce((sum, page) => sum + page.faqCount, 0);
    const hasFaqSchema = bundle.pages.some((page) => hasSchema(page, /FAQPage/i));
    const findings: string[] = [];
    const recommendations: string[] = [];
    let score = 0;

    score += addIf(faqCount >= 4, 38, findings, recommendations, `${faqCount} vraag-antwoord signalen gevonden.`, 'Voeg minimaal 4 veelgestelde vragen toe op belangrijke pagina’s.');
    score += addIf(hasFaqSchema, 32, findings, recommendations, 'FAQ schema is aanwezig.', 'Markeer FAQ’s met FAQPage structured data.');
    score += addIf(bundle.pages.some((page) => /wat|waarom|hoe|wanneer|kosten|prijs/i.test(page.text)), 18, findings, recommendations, 'Content bevat uitleg rond klantvragen.', 'Beantwoord koopgerichte vragen zoals kosten, werkwijze en keuzecriteria.');
    score += addIf(bundle.pages.length > 1, 12, findings, recommendations, 'Meerdere pagina’s geven context.', 'Maak aparte uitlegpagina’s voor belangrijke diensten en vragen.');

    return completed({
      key: 'aeo',
      label: 'AEO Audit',
      score,
      summary: 'Analyseert FAQ’s, FAQ schema en antwoordstructuur.',
      findings,
      recommendations,
      evidence: { faqCount, hasFaqSchema },
    });
  }
}

export class AIOAuditService {
  analyze(bundle: CrawlBundle): AuditScore {
    const text = allText(bundle);
    const headings = bundle.pages.flatMap((page) => [...page.headings.h1, ...page.headings.h2]);
    const findings: string[] = [];
    const recommendations: string[] = [];
    let score = 15;

    score += addIf(headings.length >= 5, 16, findings, recommendations, 'Semantische kopstructuur is bruikbaar.', 'Gebruik duidelijke koppen die diensten, voordelen en regio’s benoemen.');
    score += addIf(bundle.pages.some((page) => page.wordCount >= 450), 18, findings, recommendations, 'Er is voldoende inhoud voor context.', 'Breid dunne pagina’s uit met concrete uitleg, bewijs en voorbeelden.');
    score += addIf(/voor wie|doelgroep|ondernemers|klanten|bedrijven|particulieren/i.test(text), 14, findings, recommendations, 'Doelgroep wordt benoemd.', 'Maak expliciet voor wie de dienst bedoeld is.');
    score += addIf(/resultaat|voordeel|vertrouwen|zichtbaarheid|aanvragen|groei/i.test(text), 14, findings, recommendations, 'Voordelen en resultaten komen terug in de tekst.', 'Vertaal technische onderdelen naar concrete ondernemersvoordelen.');
    score += addIf(bundle.pages.some((page) => page.schemaTypes.length > 0), 16, findings, recommendations, 'Structured data ondersteunt AI-interpretatie.', 'Voeg schema toe voor organisatie, diensten, FAQ en breadcrumbs.');
    score += addIf(bundle.pages.some((page) => page.faqCount > 0), 12, findings, recommendations, 'FAQ’s geven citeerbare antwoorden.', 'Voeg korte, citeerbare antwoorden toe per dienst.');

    return completed({
      key: 'aio',
      label: 'AIO Audit',
      score,
      summary: 'Controleert AI-leesbaarheid, semantische structuur en consistente entiteiten.',
      findings,
      recommendations,
    });
  }
}

export class PerformanceAuditService {
  async analyze(bundle: CrawlBundle): Promise<AuditScore> {
    if (env.googlePagespeedApiKey) {
      try {
        const response = await axios.get('https://www.googleapis.com/pagespeedonline/v5/runPagespeed', {
          timeout: 30_000,
          params: {
            url: bundle.homepage.finalUrl,
            key: env.googlePagespeedApiKey,
            strategy: 'mobile',
            category: 'performance',
          },
        });
        const lighthouse = response.data?.lighthouseResult;
        const performance = lighthouse?.categories?.performance?.score;
        const audits = lighthouse?.audits ?? {};
        const score = typeof performance === 'number' ? Math.round(performance * 100) : null;
        return completed({
          key: 'performance',
          label: 'Performance Audit',
          score,
          summary: 'Google PageSpeed Insights analyse op mobiele performance.',
          findings: [
            score !== null ? `PageSpeed performance score: ${score}/100.` : 'PageSpeed gaf geen score terug.',
          ],
          recommendations: [
            'Optimaliseer afbeeldingen, kritieke CSS, caching en JavaScript die rendering blokkeert.',
          ],
          evidence: {
            lcp: audits['largest-contentful-paint']?.displayValue,
            cls: audits['cumulative-layout-shift']?.displayValue,
            inp: audits['interaction-to-next-paint']?.displayValue,
            source: 'GOOGLE_PAGESPEED_INSIGHTS',
          },
        });
      } catch (error) {
        return completed({
          key: 'performance',
          label: 'Performance Audit',
          score: null,
          status: 'FAILED',
          summary: 'Google PageSpeed Insights kon niet worden uitgevoerd.',
          findings: [],
          recommendations: ['Controleer GOOGLE_PAGESPEED_API_KEY en probeer de audit opnieuw.'],
          evidence: { error: error instanceof Error ? error.message : 'Unknown error' },
        });
      }
    }

    const responseMs = bundle.homepage.responseTimeMs;
    const wordWeight = bundle.homepage.wordCount > 150 ? 10 : 0;
    const imagePenalty = Math.min(30, bundle.homepage.images.length * 2);
    const timingScore = responseMs < 600 ? 72 : responseMs < 1200 ? 58 : responseMs < 2200 ? 42 : 28;
    return completed({
      key: 'performance',
      label: 'Performance Audit',
      score: timingScore + wordWeight - imagePenalty,
      summary: 'Fallbackmeting op echte serverrespons en paginagewicht omdat PageSpeed API niet is geconfigureerd.',
      findings: [`Homepage reageerde in ${responseMs}ms.`, `${bundle.homepage.images.length} afbeeldingen gevonden.`],
      recommendations: ['Configureer GOOGLE_PAGESPEED_API_KEY voor volledige Core Web Vitals analyse.'],
      evidence: { source: 'FETCH_TIMING_FALLBACK', responseTimeMs: responseMs },
    });
  }
}

export class GoogleBusinessAuditService {
  analyze(bundle: CrawlBundle): AuditScore {
    const text = allText(bundle);
    const signals = [
      bundle.pages.some((page) => page.hasGoogleMaps),
      /google business|google bedrijfsprofiel|google maps|route/i.test(text),
      /\b(openingstijden|adres|route|reviews|beoordelingen)\b/i.test(text),
    ].filter(Boolean).length;

    if (signals === 0) {
      return completed({
        key: 'googleBusiness',
        label: 'Google Business Audit',
        score: null,
        status: 'UNKNOWN',
        summary: 'Google Business kan zonder geautoriseerde Google Business API niet betrouwbaar worden bevestigd.',
        findings: [],
        recommendations: ['Koppel later Google Business Profile API om profiel, categorie, reviews en foto’s volledig te controleren.'],
      });
    }

    return completed({
      key: 'googleBusiness',
      label: 'Google Business Audit',
      score: 45 + signals * 15,
      summary: 'Zoekt naar Google Maps, adres-, review- en Google Business-signalen op de website.',
      findings: [`${signals} lokale Google Business-signalen gevonden.`],
      recommendations: ['Controleer of categorieën, foto’s, diensten en reviews in Google Business volledig zijn ingevuld.'],
    });
  }
}

export class ReviewAuditService {
  analyze(bundle: CrawlBundle): AuditScore {
    const reviewPages = countPages(bundle, (page) => page.hasReviews || page.hasTestimonials);
    const reviewSchema = bundle.pages.some((page) => hasSchema(page, /Review|AggregateRating/i));
    return completed({
      key: 'reviews',
      label: 'Reputatie Audit',
      score: (reviewPages > 0 ? 48 : 0) + (reviewSchema ? 32 : 0) + (bundle.pages.some((page) => /5\s*sterren|★★★★★|⭐⭐⭐⭐⭐/i.test(page.text)) ? 20 : 0),
      summary: 'Controleert review-, testimonial- en rating-signalen.',
      findings: reviewPages > 0 ? [`Reviews of testimonials gevonden op ${reviewPages} pagina’s.`] : [],
      recommendations: [
        ...(reviewPages > 0 ? [] : ['Plaats klantreviews of testimonials zichtbaar op de homepage en dienstpagina’s.']),
        ...(reviewSchema ? [] : ['Voeg Review of AggregateRating schema toe waar dit inhoudelijk klopt.']),
      ],
    });
  }
}

export class ConversionAuditService {
  analyze(bundle: CrawlBundle): AuditScore {
    const page = bundle.homepage;
    const findings: string[] = [];
    const recommendations: string[] = [];
    let score = 0;
    score += addIf(page.ctaCount > 0, 22, findings, recommendations, `${page.ctaCount} CTA’s gevonden.`, 'Plaats een duidelijke primaire CTA boven de vouw.');
    score += addIf(page.hasContactForm, 18, findings, recommendations, 'Contactformulier aanwezig.', 'Voeg een laagdrempelig contactformulier toe.');
    score += addIf(page.hasWhatsapp, 18, findings, recommendations, 'WhatsApp-contact aanwezig.', 'Voeg een WhatsApp-knop toe voor snelle contactmomenten.');
    score += addIf(page.hasPhone, 16, findings, recommendations, 'Telefoonnummer of bel-link aanwezig.', 'Maak bellen direct mogelijk via mobiel.');
    score += addIf(page.hasAppointment, 16, findings, recommendations, 'Afspraak- of boekingssignaal aanwezig.', 'Voeg een afspraak- of kennismakingsroute toe.');
    score += addIf(page.hasAnalytics, 10, findings, recommendations, 'Analytics/tracking is zichtbaar aanwezig.', 'Meet CTA-clicks, formulieren en WhatsApp-contact als conversies.');
    return completed({
      key: 'conversion',
      label: 'Conversie Audit',
      score,
      summary: 'Controleert CTA’s, formulieren, WhatsApp, telefoon en afspraakmogelijkheden.',
      findings,
      recommendations,
    });
  }
}

export class SecurityAuditService {
  analyze(bundle: CrawlBundle): AuditScore {
    const headers = bundle.homepage.headers;
    const isHttps = new URL(bundle.homepage.finalUrl).protocol === 'https:';
    const findings: string[] = [];
    const recommendations: string[] = [];
    let score = 0;
    score += addIf(isHttps, 20, findings, recommendations, 'HTTPS is actief.', 'Gebruik HTTPS met geldig SSL-certificaat.');
    score += addIf(Boolean(headers['strict-transport-security']), 14, findings, recommendations, 'HSTS header is aanwezig.', 'Voeg Strict-Transport-Security toe.');
    score += addIf(Boolean(headers['content-security-policy']), 16, findings, recommendations, 'CSP header is aanwezig.', 'Voeg Content-Security-Policy toe om script-injecties te beperken.');
    score += addIf(Boolean(headers['x-frame-options']), 12, findings, recommendations, 'X-Frame-Options is aanwezig.', 'Voeg X-Frame-Options of frame-ancestors toe.');
    score += addIf(Boolean(headers['x-content-type-options']), 10, findings, recommendations, 'X-Content-Type-Options is aanwezig.', 'Voeg X-Content-Type-Options: nosniff toe.');
    score += addIf(Boolean(headers['referrer-policy']), 10, findings, recommendations, 'Referrer-Policy is aanwezig.', 'Voeg een Referrer-Policy toe.');
    score += addIf(bundle.spfPresent, 9, findings, recommendations, 'SPF-record gevonden.', 'Publiceer een SPF-record voor e-mailbetrouwbaarheid.');
    score += addIf(bundle.dmarcPresent, 9, findings, recommendations, 'DMARC-record gevonden.', 'Publiceer een DMARC-record voor domeinbescherming.');
    return completed({
      key: 'security',
      label: 'Security Audit',
      score,
      summary: 'Controleert HTTPS, security headers en e-mail DNS-records.',
      findings,
      recommendations,
      evidence: {
        headers: {
          hsts: headers['strict-transport-security'],
          csp: headers['content-security-policy'],
          xFrameOptions: headers['x-frame-options'],
          xContentTypeOptions: headers['x-content-type-options'],
          referrerPolicy: headers['referrer-policy'],
        },
        spfPresent: bundle.spfPresent,
        dmarcPresent: bundle.dmarcPresent,
      },
    });
  }
}

export class TrustAuditService {
  analyze(bundle: CrawlBundle): AuditScore {
    const text = allText(bundle);
    const findings: string[] = [];
    const recommendations: string[] = [];
    let score = 0;
    score += addIf(bundle.pages.some((page) => page.hasReviews || page.hasTestimonials), 24, findings, recommendations, 'Reviews/testimonials zijn aanwezig.', 'Plaats bewijs zoals reviews, cases of klantlogo’s.');
    score += addIf(/over ons|over mij|team|ervaring|specialist/i.test(text), 20, findings, recommendations, 'Over-ons of expertise-signalen gevonden.', 'Vertel wie achter het bedrijf zit en waarom klanten kunnen vertrouwen.');
    score += addIf(bundle.pages.some((page) => page.hasPhone) || /@/.test(text), 18, findings, recommendations, 'Contactinformatie is aanwezig.', 'Maak contactgegevens duidelijk zichtbaar op elke belangrijke pagina.');
    score += addIf(/kvk|btw|algemene voorwaarden|privacy/i.test(text), 14, findings, recommendations, 'Juridische of bedrijfsgegevens gevonden.', 'Toon KvK, privacybeleid en voorwaarden waar passend.');
    score += addIf(bundle.pages.some((page) => hasSchema(page, /Organization|LocalBusiness/i)), 14, findings, recommendations, 'Organisatie-schema is aanwezig.', 'Voeg Organization/LocalBusiness schema toe.');
    score += addIf(/case|portfolio|resultaat|voorbeelden/i.test(text), 10, findings, recommendations, 'Voorbeelden of resultaten worden benoemd.', 'Laat voorbeelden of cases zien om vertrouwen op te bouwen.');
    return completed({
      key: 'trust',
      label: 'Trust & Autoriteit Audit',
      score,
      summary: 'Controleert bewijs, reviews, over-ons content, contactinformatie en autoriteit.',
      findings,
      recommendations,
    });
  }
}

export class LocalSEOAuditService {
  analyze(bundle: CrawlBundle): AuditScore {
    const text = allText(bundle);
    const locationMatches = text.match(/\b(den bosch|eindhoven|tilburg|breda|nijmegen|amsterdam|rotterdam|utrecht|regio|omgeving|lokaal)\b/gi) ?? [];
    const findings: string[] = [];
    const recommendations: string[] = [];
    let score = 0;
    score += addIf(locationMatches.length >= 2, 28, findings, recommendations, 'Lokale plaats- of regiosignalen gevonden.', 'Noem relevante plaatsen en regio’s op natuurlijke wijze.');
    score += addIf(bundle.pages.some((page) => page.hasGoogleMaps), 18, findings, recommendations, 'Google Maps of route-informatie gevonden.', 'Voeg kaart, route of lokaal adres toe wanneer relevant.');
    score += addIf(/adres|openingstijden|route|werkgebied/i.test(text), 18, findings, recommendations, 'Lokale praktische informatie gevonden.', 'Maak adres, werkgebied en openingstijden duidelijk.');
    score += addIf(bundle.pages.some((page) => hasSchema(page, /LocalBusiness/i)), 20, findings, recommendations, 'LocalBusiness schema is aanwezig.', 'Voeg LocalBusiness schema toe met plaats, contact en diensten.');
    score += addIf(/reviews|beoordelingen|ervaringen/i.test(text), 16, findings, recommendations, 'Reviews ondersteunen lokale betrouwbaarheid.', 'Gebruik lokale reviews om vertrouwen in de regio te vergroten.');
    return completed({
      key: 'localSeo',
      label: 'Lokale Vindbaarheid Audit',
      score,
      summary: 'Controleert plaatsnamen, lokale zoekwoorden, Google Maps en LocalBusiness signalen.',
      findings,
      recommendations,
    });
  }
}

export class AIVisibilityAuditService {
  analyze(bundle: CrawlBundle): AuditScore {
    const text = allText(bundle);
    const schemaCount = bundle.pages.reduce((sum, page) => sum + page.schemaTypes.length, 0);
    const faqCount = bundle.pages.reduce((sum, page) => sum + page.faqCount, 0);
    const findings: string[] = [];
    const recommendations: string[] = [];
    let score = 0;
    score += addIf(faqCount >= 4, 24, findings, recommendations, 'FAQ’s maken content citeerbaar.', 'Voeg per dienst korte, directe FAQ-antwoorden toe.');
    score += addIf(schemaCount >= 3, 24, findings, recommendations, 'Meerdere structured data types gevonden.', 'Gebruik Organization, LocalBusiness, Service, Breadcrumb en FAQ schema.');
    score += addIf(/wij helpen|voor ondernemers|voor klanten|diensten|specialist|resultaat/i.test(text), 18, findings, recommendations, 'Entity en doelgroep zijn deels helder.', 'Maak in één blok duidelijk wie je bent, wie je helpt en met welke diensten.');
    score += addIf(bundle.pages.some((page) => page.wordCount >= 600), 16, findings, recommendations, 'Er is verdiepende content aanwezig.', 'Maak citeerbare uitlegpagina’s rond diensten, kosten en veelgestelde vragen.');
    score += addIf(/bron|onderzoek|ervaring|case|voorbeeld|reviews/i.test(text), 10, findings, recommendations, 'Bewijs- of autoriteitssignalen gevonden.', 'Voeg bewijs, voorbeelden, reviews en cases toe.');
    score += addIf(bundle.pages.length >= 3, 8, findings, recommendations, 'Meerdere pagina’s geven context.', 'Gebruik thematische pagina’s voor diensten, branches en regio’s.');
    return completed({
      key: 'aiVisibility',
      label: 'AI Visibility Audit',
      score,
      summary: 'Controleert FAQ, structured data, entity clarity en citeerbare content.',
      findings,
      recommendations,
    });
  }
}

export class AnalyticsAuditService {
  analyze(bundle: CrawlBundle): AuditScore {
    return completed({
      key: 'analytics',
      label: 'Google Analytics Audit',
      score: bundle.pages.some((page) => page.hasAnalytics) ? 78 : 22,
      summary: 'Controleert zichtbare analytics- en tagmanager-signalen in HTML.',
      findings: bundle.pages.some((page) => page.hasAnalytics) ? ['Analytics of Tag Manager snippet gevonden.'] : [],
      recommendations: bundle.pages.some((page) => page.hasAnalytics)
        ? ['Controleer of conversies zoals formulieren, WhatsApp en telefoontaps ook als events worden gemeten.']
        : ['Installeer GA4 of Tag Manager en meet belangrijke contactmomenten als conversies.'],
    });
  }
}

export class BlogAuditService {
  analyze(bundle: CrawlBundle): AuditScore {
    const blogSignals = bundle.pages.filter((page) => /blog|nieuws|kennis|tips|artikel/i.test(`${page.finalUrl} ${page.text}`)).length;
    const longPages = bundle.pages.filter((page) => page.wordCount >= 700).length;
    return completed({
      key: 'blog',
      label: 'Blog Audit',
      score: Math.min(100, blogSignals * 30 + longPages * 18 + (bundle.pages.length >= 4 ? 16 : 0)),
      summary: 'Controleert of er informatieve content of blogsignalen aanwezig zijn.',
      findings: blogSignals > 0 ? [`${blogSignals} blog- of kennissignalen gevonden.`] : [],
      recommendations: blogSignals > 0
        ? ['Publiceer regelmatig artikelen rond klantvragen, lokale zoekopdrachten en keuzecriteria.']
        : ['Start met blogartikelen rond concrete klantvragen om langdurige vindbaarheid op te bouwen.'],
    });
  }
}

export class FAQAuditService {
  analyze(bundle: CrawlBundle): AuditScore {
    const faqCount = bundle.pages.reduce((sum, page) => sum + page.faqCount, 0);
    const hasFaqSchema = bundle.pages.some((page) => hasSchema(page, /FAQPage/i));
    return completed({
      key: 'faq',
      label: 'FAQ Audit',
      score: Math.min(100, faqCount * 12 + (hasFaqSchema ? 34 : 0)),
      summary: 'Controleert FAQ-content en FAQPage structured data.',
      findings: faqCount > 0 ? [`${faqCount} FAQ-signalen gevonden.`] : [],
      recommendations: [
        ...(faqCount >= 4 ? [] : ['Voeg 4 tot 6 veelgestelde vragen toe aan belangrijke pagina’s.']),
        ...(hasFaqSchema ? [] : ['Voeg FAQPage schema toe voor betere AEO/AI-zichtbaarheid.']),
      ],
    });
  }
}

export class BacklinkAuditService {
  analyze(bundle: CrawlBundle): AuditScore {
    const outboundAuthorityLinks = bundle.pages
      .flatMap((page) => page.links)
      .filter((link) => /google|facebook|instagram|linkedin|trustpilot|jotform|branche|maps/i.test(link)).length;
    return completed({
      key: 'backlink',
      label: 'Backlink Audit',
      score: null,
      status: 'UNKNOWN',
      summary: 'Backlinks kunnen zonder externe backlink-API niet betrouwbaar worden gemeten.',
      findings: outboundAuthorityLinks ? [`${outboundAuthorityLinks} externe autoriteitssignalen op de site gevonden.`] : [],
      recommendations: ['Koppel later Ahrefs, Semrush of Google Search Console voor echte backlinkdata.'],
      evidence: { outboundAuthorityLinks },
    });
  }
}

export class LeadCaptureAuditService {
  analyze(bundle: CrawlBundle): AuditScore {
    const page = bundle.homepage;
    return completed({
      key: 'leadCapture',
      label: 'Lead Capture Audit',
      score: (page.hasContactForm ? 30 : 0) + (page.hasWhatsapp ? 24 : 0) + (page.hasPhone ? 18 : 0) + (page.ctaCount > 1 ? 18 : 0) + (page.hasAppointment ? 10 : 0),
      summary: 'Controleert of bezoekers makkelijk lead kunnen worden.',
      findings: [
        ...(page.hasContactForm ? ['Contactformulier aanwezig.'] : []),
        ...(page.hasWhatsapp ? ['WhatsApp-route aanwezig.'] : []),
        ...(page.hasPhone ? ['Telefoonroute aanwezig.'] : []),
      ],
      recommendations: [
        ...(page.hasContactForm ? [] : ['Voeg een kort contactformulier toe.']),
        ...(page.hasWhatsapp ? [] : ['Voeg een WhatsApp-knop toe voor snelle vragen.']),
        ...(page.ctaCount > 1 ? [] : ['Herhaal CTA’s op logische momenten door de pagina.']),
      ],
    });
  }
}

export class ContentQualityAuditService {
  analyze(bundle: CrawlBundle): AuditScore {
    const avgWords = Math.round(bundle.pages.reduce((sum, page) => sum + page.wordCount, 0) / bundle.pages.length);
    const usefulHeadings = bundle.pages.reduce((sum, page) => sum + page.headings.h2.length + page.headings.h3.length, 0);
    const thinPages = bundle.pages.filter((page) => page.wordCount < 250).length;
    return completed({
      key: 'contentQuality',
      label: 'Content Kwaliteit Audit',
      score: Math.min(100, (avgWords >= 500 ? 36 : avgWords >= 300 ? 24 : 10) + Math.min(28, usefulHeadings * 3) + (thinPages === 0 ? 20 : 4) + (bundle.pages.some((page) => page.images.some((image) => image.alt)) ? 16 : 0)),
      summary: 'Controleert inhoudelijke diepte, kopstructuur, dunne pagina’s en beeldcontext.',
      findings: [`Gemiddeld ${avgWords} woorden per gecrawlde pagina.`, `${usefulHeadings} H2/H3-koppen gevonden.`],
      recommendations: [
        ...(thinPages === 0 ? [] : ['Breid dunne pagina’s uit met voordelen, bewijs, FAQ’s en duidelijke CTA’s.']),
        'Schrijf content rond klantvragen, resultaten en lokale zoekintentie.',
      ],
    });
  }
}
