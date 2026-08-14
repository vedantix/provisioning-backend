import axios from 'axios';
import { env } from '../../../config/env';
import type {
  AuditCategoryKey,
  AuditConfidence,
  AuditEvidenceItem,
  AuditScore,
  CrawlBundle,
  CrawledPage,
} from '../types/online-growth-audit.types';

type ScoreDraft = Omit<
  AuditScore,
  'status' | 'confidence' | 'evidenceItems' | 'measuredChecks' | 'totalChecks'
> & {
  score: number | null;
  status?: AuditScore['status'];
  confidence?: AuditConfidence;
  evidenceItems?: AuditEvidenceItem[];
  measuredChecks?: number;
  totalChecks?: number;
};

type AuditCheck = Omit<AuditEvidenceItem, 'status'> & {
  status: AuditEvidenceItem['status'] | boolean | null;
  recommendation?: string;
  finding?: string;
};

function clamp(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function completed(draft: ScoreDraft): AuditScore {
  const evidenceItems = draft.evidenceItems ?? [];
  const measuredChecks = draft.measuredChecks ?? evidenceItems.filter((item) => item.status !== 'UNKNOWN').length;
  const totalChecks = draft.totalChecks ?? evidenceItems.length;
  return {
    ...draft,
    score: draft.score === null ? null : clamp(draft.score),
    status: draft.status ?? (draft.score === null ? 'UNKNOWN' : 'COMPLETED'),
    confidence: draft.confidence ?? (draft.score === null ? 'LOW' : 'MEDIUM'),
    findings: draft.findings.slice(0, 8),
    recommendations: draft.recommendations.slice(0, 8),
    evidenceItems,
    measuredChecks,
    totalChecks,
  };
}

function scoreChecks(input: {
  key: AuditCategoryKey;
  label: string;
  summary: string;
  checks: AuditCheck[];
  confidence?: AuditConfidence;
  evidence?: Record<string, unknown>;
}): AuditScore {
  const evidenceItems: AuditEvidenceItem[] = input.checks.map((check) => ({
    check: check.check,
    label: check.label,
    status: check.status === null ? 'UNKNOWN' : check.status === true ? 'PASS' : check.status === false ? 'FAIL' : check.status,
    observed: check.observed,
    source: check.source,
    weight: check.weight,
    url: check.url,
  }));
  const measured = input.checks.filter((check) => check.status !== null && check.status !== 'UNKNOWN');
  const measuredWeight = measured.reduce((sum, check) => sum + check.weight, 0);
  const passedWeight = measured
    .filter((check) => check.status === true || check.status === 'PASS')
    .reduce((sum, check) => sum + check.weight, 0);
  const score = measuredWeight > 0 ? (passedWeight / measuredWeight) * 100 : null;
  const findings = input.checks
    .filter((check) => check.status === true || check.status === 'PASS')
    .map((check) => check.finding || `${check.label}: ${check.observed}`);
  const recommendations = input.checks
    .filter((check) => check.status === false || check.status === 'FAIL')
    .map((check) => check.recommendation)
    .filter((item): item is string => Boolean(item));

  return completed({
    key: input.key,
    label: input.label,
    score,
    status: score === null ? 'UNKNOWN' : 'COMPLETED',
    confidence: input.confidence ?? (measured.length === input.checks.length ? 'HIGH' : 'MEDIUM'),
    summary: input.summary,
    findings,
    recommendations,
    evidenceItems,
    measuredChecks: measured.length,
    totalChecks: input.checks.length,
    evidence: input.evidence,
  });
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
    const indexablePages = bundle.pages.filter((item) => !item.hasNoindex);
    const uniqueTitles = new Set(indexablePages.map((item) => item.title).filter(Boolean)).size;
    const uniqueDescriptions = new Set(indexablePages.map((item) => item.metaDescription).filter(Boolean)).size;
    const pagesWithCanonical = indexablePages.filter((item) => item.canonical).length;
    const pagesWithOneH1 = indexablePages.filter((item) => item.headings.h1.length === 1).length;

    return scoreChecks({
      key: 'seo',
      label: 'SEO Audit',
      summary: `Technische on-page SEO op ${bundle.pages.length} gecrawlde pagina’s, inclusief unieke metadata, indexeerbaarheid en crawlbestanden.`,
      confidence: bundle.pages.length >= 4 ? 'HIGH' : 'MEDIUM',
      checks: [
        {
          check: 'homepage-title',
          label: 'Homepage title',
          status: Boolean(page.title && page.title.length >= 25 && page.title.length <= 65),
          observed: page.title ? `${page.title.length} tekens: ${page.title}` : 'Niet gevonden',
          source: 'HTML <title>',
          url: page.finalUrl,
          weight: 14,
          recommendation: 'Schrijf een unieke title van circa 25–65 tekens met hoofdservice en merknaam.',
        },
        {
          check: 'homepage-description',
          label: 'Homepage meta description',
          status: Boolean(page.metaDescription && page.metaDescription.length >= 70 && page.metaDescription.length <= 170),
          observed: page.metaDescription ? `${page.metaDescription.length} tekens` : 'Niet gevonden',
          source: 'HTML meta[name=description]',
          url: page.finalUrl,
          weight: 12,
          recommendation: 'Schrijf een overtuigende meta description van circa 70–170 tekens.',
        },
        {
          check: 'unique-titles',
          label: 'Unieke paginatitels',
          status: uniqueTitles === indexablePages.length,
          observed: `${uniqueTitles} unieke titles op ${indexablePages.length} indexeerbare pagina’s`,
          source: 'Gecrawlde pagina’s',
          weight: 13,
          recommendation: 'Geef iedere indexeerbare pagina een eigen, inhoudelijk passende title.',
        },
        {
          check: 'unique-descriptions',
          label: 'Unieke meta descriptions',
          status: uniqueDescriptions === indexablePages.length,
          observed: `${uniqueDescriptions} unieke descriptions op ${indexablePages.length} indexeerbare pagina’s`,
          source: 'Gecrawlde pagina’s',
          weight: 9,
          recommendation: 'Maak descriptions uniek per pagina; hergebruik geen homepage-metadata.',
        },
        {
          check: 'h1-structure',
          label: 'Eén H1 per pagina',
          status: pagesWithOneH1 === indexablePages.length,
          observed: `${pagesWithOneH1} van ${indexablePages.length} pagina’s hebben precies één H1`,
          source: 'Gecrawlde DOM',
          weight: 12,
          recommendation: 'Gebruik op iedere belangrijke pagina precies één beschrijvende H1.',
        },
        {
          check: 'canonical',
          label: 'Canonical per pagina',
          status: pagesWithCanonical === indexablePages.length,
          observed: `${pagesWithCanonical} van ${indexablePages.length} pagina’s hebben een canonical`,
          source: 'HTML link[rel=canonical]',
          weight: 10,
          recommendation: 'Plaats op iedere indexeerbare pagina een correcte zelfverwijzende canonical.',
        },
        {
          check: 'sitemap',
          label: 'XML-sitemap',
          status: bundle.sitemapAvailable && bundle.sitemapUrlCount > 0,
          observed: bundle.sitemapAvailable ? `${bundle.sitemapUrlCount} URL’s gevonden` : 'Niet bereikbaar',
          source: `${new URL('/sitemap.xml', page.finalUrl)}`,
          weight: 12,
          recommendation: 'Publiceer een geldige sitemap.xml met alle canonieke, indexeerbare URL’s.',
        },
        {
          check: 'robots',
          label: 'Robots.txt',
          status: bundle.robotsAvailable,
          observed: bundle.robotsAvailable ? 'Bereikbaar' : 'Niet bereikbaar',
          source: `${new URL('/robots.txt', page.finalUrl)}`,
          weight: 8,
          recommendation: 'Publiceer robots.txt en verwijs daarin naar de sitemap.',
        },
        {
          check: 'structured-data',
          label: 'Geldige structured data',
          status: page.schemaTypes.length > 0 && bundle.pages.every((item) => item.invalidSchemaCount === 0),
          observed: page.schemaTypes.length ? page.schemaTypes.join(', ') : 'Geen types gevonden',
          source: 'JSON-LD',
          weight: 10,
          recommendation: 'Voeg geldige Organization/LocalBusiness-, Service- en Breadcrumb-schema’s toe.',
        },
      ],
      evidence: {
        title: page.title,
        metaDescription: page.metaDescription,
        pagesAnalyzed: bundle.pages.length,
        indexablePages: indexablePages.length,
        schemaTypes: page.schemaTypes,
      },
    });
  }
}

export class GEOAuditService {
  analyze(bundle: CrawlBundle): AuditScore {
    const text = allText(bundle);
    const entitySchemas = Array.from(
      new Set(bundle.pages.flatMap((page) => page.schemaTypes).filter((type) => /Organization|LocalBusiness|ProfessionalService/i.test(type))),
    );
    const contactPages = bundle.pages.filter((page) => page.hasPhone || page.hasEmail || page.hasAddress);
    const servicePages = bundle.pages.filter((page) => /dienst|service|oplossing|aanbod|specialist/i.test(`${page.finalUrl} ${page.text}`));
    const trustPages = bundle.pages.filter((page) => page.hasNamedTestimonials || /case|portfolio|resultaat|onderzoek|bron/i.test(page.text));

    return scoreChecks({
      key: 'geo',
      label: 'GEO Audit',
      summary: 'Meet of generatieve zoekmachines de organisatie, diensten, doelgroep, locatie en bewijs eenduidig uit de site kunnen halen.',
      confidence: bundle.pages.length >= 4 ? 'HIGH' : 'MEDIUM',
      checks: [
        {
          check: 'entity-schema',
          label: 'Organisatie-entiteit',
          status: entitySchemas.length > 0,
          observed: entitySchemas.length ? entitySchemas.join(', ') : 'Geen Organization/LocalBusiness-schema gevonden',
          source: 'JSON-LD op gecrawlde pagina’s',
          weight: 24,
          recommendation: 'Publiceer één consistente Organization- of LocalBusiness-entiteit met naam, URL, logo, contact en sameAs-profielen.',
        },
        {
          check: 'services-explicit',
          label: 'Diensten expliciet beschreven',
          status: servicePages.length >= 2,
          observed: `${servicePages.length} pagina’s met duidelijke dienstsignalen`,
          source: 'Zichtbare content en URL’s',
          weight: 19,
          recommendation: 'Maak aparte, concrete dienstpagina’s met doelgroep, aanpak, resultaat en keuzecriteria.',
        },
        {
          check: 'contact-identity',
          label: 'Contact en identiteit',
          status: contactPages.length > 0 && bundle.pages.some((page) => page.hasPhone) && bundle.pages.some((page) => page.hasEmail),
          observed: `${contactPages.length} pagina’s met telefoon, e-mail of adres`,
          source: 'Zichtbare content en contactlinks',
          weight: 17,
          recommendation: 'Maak bedrijfsnaam, e-mail, telefoon en vestigings-/werkgebied consistent zichtbaar.',
        },
        {
          check: 'audience',
          label: 'Doelgroep benoemd',
          status: /voor (zzp|ondernemers|bedrijven|mkb|particulieren|verenigingen|zorg|horeca)|doelgroep|klanten/i.test(text),
          observed: /doelgroep|voor ondernemers|voor bedrijven|voor klanten/i.test(text) ? 'Doelgroepsignalen gevonden' : 'Geen duidelijke doelgroepformulering gevonden',
          source: 'Zichtbare content',
          weight: 14,
          recommendation: 'Schrijf letterlijk voor wie iedere dienst bedoeld is en welk probleem die oplost.',
        },
        {
          check: 'location',
          label: 'Vestiging of werkgebied',
          status: bundle.pages.some((page) => page.hasAddress) || /werkgebied|gevestigd in|actief in|regio|omgeving|nederland/i.test(text),
          observed: bundle.pages.some((page) => page.hasAddress) ? 'Postadres of postcode gevonden' : 'Alleen tekstuele regiosignalen gecontroleerd',
          source: 'Zichtbare content',
          weight: 13,
          recommendation: 'Noem vestigingsplaats en werkgebied op de contact-, over-ons- en relevante dienstpagina’s.',
        },
        {
          check: 'verifiable-proof',
          label: 'Controleerbaar bewijs',
          status: trustPages.length > 0,
          observed: `${trustPages.length} pagina’s met cases, bronnen, resultaten of herkenbare testimonials`,
          source: 'Zichtbare content',
          weight: 13,
          recommendation: 'Voeg cases, concrete resultaten, bronnen en herkenbare klantquotes toe; vermijd onbewezen claims.',
        },
      ],
    });
  }
}

export class AEOAuditService {
  analyze(bundle: CrawlBundle): AuditScore {
    const faqCount = bundle.pages.reduce((sum, page) => sum + page.faqCount, 0);
    const hasFaqSchema = bundle.pages.some((page) => hasSchema(page, /FAQPage/i));
    const questionHeadings = bundle.pages.reduce(
      (sum, page) => sum + [...page.headings.h2, ...page.headings.h3].filter((heading) => heading.endsWith('?')).length,
      0,
    );
    const commercialAnswers = bundle.pages.filter((page) => /\b(kosten|prijs|tarief|werkwijze|hoe werkt|doorlooptijd|wanneer|wat krijg)\b/i.test(page.text)).length;

    return scoreChecks({
      key: 'aeo',
      label: 'AEO Audit',
      summary: 'Controleert of concrete klantvragen direct, scanbaar en machineleesbaar worden beantwoord.',
      confidence: 'HIGH',
      checks: [
        {
          check: 'question-content',
          label: 'Vraaggestuurde content',
          status: faqCount >= 4 || questionHeadings >= 4,
          observed: `${faqCount} unieke FAQ-signalen en ${questionHeadings} vraagkoppen`,
          source: 'Gecrawlde DOM',
          weight: 35,
          recommendation: 'Voeg per belangrijke dienst 4–6 echte klantvragen met een direct antwoord toe.',
        },
        {
          check: 'faq-schema',
          label: 'FAQPage structured data',
          status: hasFaqSchema,
          observed: hasFaqSchema ? 'FAQPage gevonden' : 'Niet gevonden',
          source: 'JSON-LD',
          weight: 25,
          recommendation: 'Markeer alleen zichtbare FAQ’s met correct FAQPage-schema.',
        },
        {
          check: 'commercial-answers',
          label: 'Koopgerichte antwoorden',
          status: commercialAnswers >= 2,
          observed: `${commercialAnswers} pagina’s behandelen kosten, werkwijze of doorlooptijd`,
          source: 'Zichtbare content',
          weight: 25,
          recommendation: 'Beantwoord kosten, aanpak, planning, voorwaarden en keuzecriteria concreet.',
        },
        {
          check: 'answer-depth',
          label: 'Voldoende antwoordcontext',
          status: bundle.pages.some((page) => page.faqCount > 0 && page.wordCount >= 350),
          observed: bundle.pages.some((page) => page.faqCount > 0 && page.wordCount >= 350) ? 'FAQ staat op een inhoudelijke pagina' : 'FAQ-context is dun of niet gevonden',
          source: 'Gecrawlde DOM',
          weight: 15,
          recommendation: 'Plaats antwoorden in inhoudelijke context met voorbeelden en interne links.',
        },
      ],
      evidence: { faqCount, hasFaqSchema },
    });
  }
}

export class AIOAuditService {
  analyze(bundle: CrawlBundle): AuditScore {
    const text = allText(bundle);
    const semanticPages = bundle.pages.filter((page) => page.headings.h1.length === 1 && page.headings.h2.length >= 2);
    const entitySchema = bundle.pages.some((page) => hasSchema(page, /Organization|LocalBusiness|ProfessionalService/i));
    const serviceSchema = bundle.pages.some((page) => hasSchema(page, /Service|Product/i));
    const sourceSignals = /bron|onderzoek|case|resultaat|portfolio|review|ervaring/i.test(text);

    return scoreChecks({
      key: 'aio',
      label: 'AIO Audit',
      summary: 'Meet technische en inhoudelijke signalen waarmee AI-systemen de site kunnen ontdekken, begrijpen en onderbouwen.',
      confidence: bundle.homepage.renderMode === 'STATIC_FALLBACK' ? 'LOW' : 'HIGH',
      checks: [
        {
          check: 'semantic-structure',
          label: 'Semantische paginastructuur',
          status: semanticPages.length >= Math.max(1, Math.ceil(bundle.pages.length * 0.6)),
          observed: `${semanticPages.length} van ${bundle.pages.length} pagina’s hebben één H1 en meerdere H2’s`,
          source: 'Gecrawlde DOM',
          weight: 18,
          recommendation: 'Gebruik per pagina één H1 en logisch geneste H2/H3-koppen die de inhoud beschrijven.',
        },
        {
          check: 'entity-graph',
          label: 'Entiteit en diensten in schema',
          status: entitySchema && serviceSchema,
          observed: `Organisatie: ${entitySchema ? 'ja' : 'nee'}; diensten/producten: ${serviceSchema ? 'ja' : 'nee'}`,
          source: 'JSON-LD',
          weight: 24,
          recommendation: 'Verbind Organization/LocalBusiness met Service-schema’s via consistente @id-verwijzingen.',
        },
        {
          check: 'llms-txt',
          label: 'llms.txt',
          status: bundle.llmsTxtAvailable,
          observed: bundle.llmsTxtAvailable ? 'Bereikbaar op /llms.txt' : 'Niet gevonden op /llms.txt',
          source: `${new URL('/llms.txt', bundle.homepage.finalUrl)}`,
          weight: 8,
          recommendation: 'Publiceer een beknopt llms.txt-bestand als aanvullende, experimentele wegwijzer; zie dit niet als vervanging voor crawlbare HTML.',
        },
        {
          check: 'content-depth',
          label: 'Inhoudelijke diepte',
          status: bundle.pages.filter((page) => page.wordCount >= 450).length >= 2,
          observed: `${bundle.pages.filter((page) => page.wordCount >= 450).length} pagina’s met minimaal 450 woorden`,
          source: 'Zichtbare content',
          weight: 20,
          recommendation: 'Breid kernpagina’s uit met eigen uitleg, voorbeelden, beperkingen en bewijs.',
        },
        {
          check: 'direct-answers',
          label: 'Directe antwoorden',
          status: bundle.pages.reduce((sum, page) => sum + page.faqCount, 0) >= 4,
          observed: `${bundle.pages.reduce((sum, page) => sum + page.faqCount, 0)} FAQ-signalen`,
          source: 'Gecrawlde DOM en JSON-LD',
          weight: 15,
          recommendation: 'Voeg korte, zelfstandige antwoorden toe die zonder omliggende verkooppraat begrijpelijk blijven.',
        },
        {
          check: 'source-signals',
          label: 'Bronnen en bewijs',
          status: sourceSignals,
          observed: sourceSignals ? 'Bewijs- of bronsignalen gevonden' : 'Geen duidelijke bronnen, cases of resultaten gevonden',
          source: 'Zichtbare content',
          weight: 15,
          recommendation: 'Onderbouw claims met cases, auteurschap, data, bronnen en concrete resultaten.',
        },
      ],
    });
  }
}

export class PerformanceAuditService {
  async analyze(bundle: CrawlBundle): Promise<AuditScore> {
    try {
      const response = await axios.get('https://www.googleapis.com/pagespeedonline/v5/runPagespeed', {
        timeout: 45_000,
        params: {
          url: bundle.homepage.finalUrl,
          ...(env.googlePagespeedApiKey ? { key: env.googlePagespeedApiKey } : {}),
          strategy: 'mobile',
          category: 'performance',
        },
      });
      const lighthouse = response.data?.lighthouseResult;
      const performance = lighthouse?.categories?.performance?.score;
      const audits = lighthouse?.audits ?? {};
      const score = typeof performance === 'number' ? Math.round(performance * 100) : null;
      const lcp = audits['largest-contentful-paint']?.displayValue;
      const cls = audits['cumulative-layout-shift']?.displayValue;
      const tbt = audits['total-blocking-time']?.displayValue;
      const speedIndex = audits['speed-index']?.displayValue;
      return completed({
        key: 'performance',
        label: 'Google PageSpeed (mobiel)',
        score,
        status: score === null ? 'UNKNOWN' : 'COMPLETED',
        confidence: score === null ? 'LOW' : 'HIGH',
        summary: 'Actuele mobiele Lighthouse-labmeting via de officiële Google PageSpeed Insights API.',
        findings: score === null
          ? []
          : [`Google PageSpeed performance: ${score}/100.`, `Speed Index: ${speedIndex || 'niet beschikbaar'}; LCP: ${lcp || 'niet beschikbaar'}; CLS: ${cls || 'niet beschikbaar'}.`],
        recommendations: score !== null && score >= 90
          ? []
          : ['Onderzoek de concrete PageSpeed-diagnoses voor afbeeldingen, kritieke CSS, caching en JavaScript; optimaliseer eerst de grootste gemeten vertragingen.'],
        evidenceItems: [
          {
            check: 'pagespeed-mobile',
            label: 'Mobiele performance',
            status: score === null ? 'UNKNOWN' : score >= 70 ? 'PASS' : 'FAIL',
            observed: score === null ? 'Google gaf geen Lighthouse-score terug' : `${score}/100`,
            source: 'Google PageSpeed Insights API v5',
            url: bundle.homepage.finalUrl,
            weight: 100,
          },
        ],
        measuredChecks: score === null ? 0 : 1,
        totalChecks: 1,
        evidence: {
          score,
          speedIndex,
          lcp,
          cls,
          totalBlockingTime: tbt,
          source: 'GOOGLE_PAGESPEED_INSIGHTS',
        },
      });
    } catch (error) {
      const errorMessage = axios.isAxiosError(error)
        ? `${error.response?.status || 'netwerk'}: ${error.response?.data?.error?.message || error.message}`
        : error instanceof Error ? error.message : 'Onbekende fout';
      return completed({
        key: 'performance',
        label: 'Google PageSpeed (mobiel)',
        score: null,
        status: 'FAILED',
        confidence: 'LOW',
        summary: 'Google PageSpeed Insights was tijdens deze audit niet beschikbaar; er is bewust geen vervangend performancecijfer verzonnen.',
        findings: [`De HTML-serverrespons duurde ${bundle.homepage.responseTimeMs} ms; dit is geen Core Web Vitals-meting.`],
        recommendations: ['Voer PageSpeed Insights later opnieuw uit; gebruik de serverresponsduur niet als vervanging voor gebruikersperformance.'],
        evidenceItems: [
          {
            check: 'pagespeed-mobile',
            label: 'Mobiele performance',
            status: 'UNKNOWN',
            observed: `Niet gemeten (${errorMessage})`,
            source: 'Google PageSpeed Insights API v5',
            url: bundle.homepage.finalUrl,
            weight: 100,
          },
        ],
        measuredChecks: 0,
        totalChecks: 1,
        evidence: { error: errorMessage, responseTimeMs: bundle.homepage.responseTimeMs },
      });
    }
  }
}

export class GoogleBusinessAuditService {
  analyze(bundle: CrawlBundle): AuditScore {
    const mapsPages = bundle.pages.filter((page) => page.hasGoogleMaps);
    const hasAddress = bundle.pages.some((page) => page.hasAddress);
    return completed({
      key: 'googleBusiness',
      label: 'Google Bedrijfsprofiel',
      score: null,
      status: 'UNKNOWN',
      confidence: 'LOW',
      summary: 'Een websitecrawl kan niet betrouwbaar bewijzen of een Google Bedrijfsprofiel bestaat, geverifieerd is of volledig is ingevuld.',
      findings: [
        ...(mapsPages.length ? [`Google Maps-/profielsignalen gevonden op ${mapsPages.length} pagina’s.`] : []),
        ...(hasAddress ? ['Een postadres of postcode is op de website zichtbaar.'] : []),
      ],
      recommendations: ['Koppel een geautoriseerd Google Bedrijfsprofiel om categorie, verificatie, diensten, foto’s, openingstijden en reviews echt te controleren.'],
      evidenceItems: [
        {
          check: 'google-business-profile',
          label: 'Profielstatus en volledigheid',
          status: 'UNKNOWN',
          observed: mapsPages.length ? 'Website bevat een Google Maps-/profielsignaal, maar profielstatus is niet geverifieerd' : 'Niet verifieerbaar vanuit de website',
          source: 'Websitecrawl; geen geautoriseerde Google Business Profile API',
          weight: 100,
        },
      ],
      measuredChecks: 0,
      totalChecks: 1,
    });
  }
}

export class ReviewAuditService {
  analyze(bundle: CrawlBundle): AuditScore {
    const reviewPages = countPages(bundle, (page) => page.hasTestimonials);
    const reviewSchema = bundle.pages.some((page) => hasSchema(page, /Review|AggregateRating/i));
    const namedTestimonials = bundle.pages.some((page) => page.hasNamedTestimonials);
    const reviewPlatformLink = bundle.pages.some((page) => page.hasReviewPlatformLink);
    const onSiteScore = scoreChecks({
      key: 'reviews',
      label: 'Reviews & reputatie',
      summary: 'Meet alleen controleerbare reputatiesignalen op de website; externe Google-rating en reviewaantallen zijn zonder koppeling niet geverifieerd.',
      confidence: 'MEDIUM',
      checks: [
        {
          check: 'onsite-testimonials',
          label: 'Zichtbare testimonials',
          status: reviewPages > 0,
          observed: `${reviewPages} pagina’s met herkenbare testimonialsecties`,
          source: 'Gecrawlde DOM',
          weight: 45,
          recommendation: 'Plaats herkenbare, concrete klantquotes met naam/bedrijf en context op relevante pagina’s.',
        },
        {
          check: 'named-testimonials',
          label: 'Herleidbaar bewijs',
          status: namedTestimonials,
          observed: namedTestimonials ? 'Testimonials met naam-/quote-signalen gevonden' : 'Geen herleidbare testimonialsignalen gevonden',
          source: 'Gecrawlde DOM',
          weight: 25,
          recommendation: 'Maak testimonials geloofwaardiger met toestemming, naam, bedrijf, datum en concrete uitkomst.',
        },
        {
          check: 'review-platform-link',
          label: 'Link naar extern reviewprofiel',
          status: reviewPlatformLink,
          observed: reviewPlatformLink ? 'Google/Trustpilot/reviewplatform-link gevonden' : 'Niet gevonden',
          source: 'Externe links op gecrawlde pagina’s',
          weight: 20,
          recommendation: 'Link zichtbaar naar het officiële reviewprofiel zodat bezoekers claims kunnen controleren.',
        },
        {
          check: 'valid-review-schema',
          label: 'Passende review structured data',
          status: reviewSchema ? true : null,
          observed: reviewSchema ? 'Review/AggregateRating-schema gevonden' : 'Niet beoordeeld: schema is niet voor ieder bedrijfstype toegestaan of nodig',
          source: 'JSON-LD',
          weight: 10,
        },
      ],
    });
    onSiteScore.evidence = { externalGoogleReviewsVerified: false, reviewPages, namedTestimonials, reviewPlatformLink };
    return onSiteScore;
  }
}

export class ConversionAuditService {
  analyze(bundle: CrawlBundle): AuditScore {
    const page = bundle.homepage;
    const pagesWithCta = bundle.pages.filter((item) => item.ctaCount > 0).length;
    const contactRouteCount = [page.hasContactForm, page.hasWhatsapp, page.hasPhone, page.hasAppointment].filter(Boolean).length;
    return scoreChecks({
      key: 'conversion',
      label: 'Conversie Audit',
      summary: 'Controleert zichtbare vervolgstappen en contactroutes; positie boven de vouw en daadwerkelijke conversieratio vragen aanvullende browser-/analyticsdata.',
      confidence: 'MEDIUM',
      checks: [
        {
          check: 'homepage-cta',
          label: 'Duidelijke homepage-CTA',
          status: page.ctaCount >= 1,
          observed: `${page.ctaCount} unieke CTA-teksten op de homepage`,
          source: 'Gecrawlde DOM',
          weight: 25,
          recommendation: 'Plaats één concrete primaire actie met een resultaatgerichte knoptekst op de homepage.',
        },
        {
          check: 'cta-coverage',
          label: 'CTA-dekking',
          status: pagesWithCta >= Math.max(1, Math.ceil(bundle.pages.length * 0.6)),
          observed: `${pagesWithCta} van ${bundle.pages.length} pagina’s bevatten een herkenbare CTA`,
          source: 'Gecrawlde DOM',
          weight: 20,
          recommendation: 'Geef iedere dienst- en informatiepagina een logische vervolgstap.',
        },
        {
          check: 'contact-routes',
          label: 'Keuze uit contactroutes',
          status: contactRouteCount >= 2,
          observed: `${contactRouteCount} routes: formulier ${page.hasContactForm ? 'ja' : 'nee'}, WhatsApp ${page.hasWhatsapp ? 'ja' : 'nee'}, telefoon ${page.hasPhone ? 'ja' : 'nee'}, afspraak ${page.hasAppointment ? 'ja' : 'nee'}`,
          source: 'Homepage DOM en links',
          weight: 30,
          recommendation: 'Bied minimaal twee laagdrempelige contactroutes, bijvoorbeeld formulier plus telefoon of WhatsApp.',
        },
        {
          check: 'trust-near-conversion',
          label: 'Vertrouwensbewijs',
          status: page.hasTestimonials || page.hasReviewPlatformLink || /case|resultaat|garantie|keurmerk/i.test(page.text),
          observed: page.hasTestimonials ? 'Testimonials op homepage gevonden' : 'Geen duidelijk bewijs op homepage gevonden',
          source: 'Homepage DOM',
          weight: 15,
          recommendation: 'Plaats controleerbaar bewijs in de buurt van belangrijke CTA’s.',
        },
        {
          check: 'conversion-measurement',
          label: 'Conversiemeting zichtbaar',
          status: page.hasAnalytics ? true : null,
          observed: page.hasAnalytics ? page.analyticsProviders.join(', ') : 'Niet aantoonbaar; tracking kan achter cookietoestemming staan',
          source: 'Scripts in gerenderde HTML',
          weight: 10,
          recommendation: 'Meet formulieren, telefoon-, afspraak- en WhatsAppkliks als expliciete conversie-events.',
        },
      ],
    });
  }
}

export class SecurityAuditService {
  analyze(bundle: CrawlBundle): AuditScore {
    const headers = bundle.homepage.headers;
    const isHttps = new URL(bundle.homepage.finalUrl).protocol === 'https:';
    return scoreChecks({
      key: 'security',
      label: 'Security Audit',
      summary: 'Controleert HTTPS, belangrijke responseheaders en publiek vindbare SPF-/DMARC-records; dit is geen penetratietest.',
      confidence: 'HIGH',
      checks: [
        { check: 'https', label: 'HTTPS', status: isHttps, observed: bundle.homepage.finalUrl, source: 'Uiteindelijke URL', weight: 22, recommendation: 'Forceer HTTPS met een geldig certificaat.' },
        { check: 'hsts', label: 'HSTS', status: Boolean(headers['strict-transport-security']), observed: headers['strict-transport-security'] || 'Niet gevonden', source: 'HTTP responseheader', weight: 14, recommendation: 'Voeg Strict-Transport-Security toe nadat HTTPS overal correct werkt.' },
        { check: 'csp', label: 'Content Security Policy', status: Boolean(headers['content-security-policy']), observed: headers['content-security-policy'] ? 'Aanwezig' : 'Niet gevonden', source: 'HTTP responseheader', weight: 16, recommendation: 'Implementeer en test een Content-Security-Policy die toegestane bronnen beperkt.' },
        { check: 'frame-protection', label: 'Clickjacking-bescherming', status: Boolean(headers['x-frame-options']) || /frame-ancestors/i.test(headers['content-security-policy'] || ''), observed: headers['x-frame-options'] || (/frame-ancestors/i.test(headers['content-security-policy'] || '') ? 'CSP frame-ancestors' : 'Niet gevonden'), source: 'HTTP responseheaders', weight: 10, recommendation: 'Gebruik CSP frame-ancestors of X-Frame-Options.' },
        { check: 'nosniff', label: 'MIME-sniffing bescherming', status: /nosniff/i.test(headers['x-content-type-options'] || ''), observed: headers['x-content-type-options'] || 'Niet gevonden', source: 'HTTP responseheader', weight: 9, recommendation: 'Voeg X-Content-Type-Options: nosniff toe.' },
        { check: 'referrer-policy', label: 'Referrer Policy', status: Boolean(headers['referrer-policy']), observed: headers['referrer-policy'] || 'Niet gevonden', source: 'HTTP responseheader', weight: 9, recommendation: 'Stel een passende Referrer-Policy in, bijvoorbeeld strict-origin-when-cross-origin.' },
        { check: 'spf', label: 'SPF', status: bundle.spfPresent, observed: bundle.spfPresent ? 'SPF-record gevonden' : 'Geen SPF-record gevonden', source: `DNS TXT ${bundle.domain}`, weight: 10, recommendation: 'Publiceer en onderhoud één geldig SPF-record voor toegestane verzenders.' },
        { check: 'dmarc', label: 'DMARC', status: bundle.dmarcPresent, observed: bundle.dmarcPresent ? 'DMARC-record gevonden' : 'Geen DMARC-record gevonden', source: `DNS TXT _dmarc.${bundle.domain}`, weight: 10, recommendation: 'Publiceer een DMARC-record en bouw het beleid gecontroleerd op.' },
        { check: 'dkim', label: 'DKIM', status: null, observed: 'Niet automatisch te verifiëren zonder de gebruikte selector(s)', source: 'DNS-selector of mailprovider vereist', weight: 5, recommendation: 'Controleer DKIM met de selectors van de actieve mailprovider.' },
      ],
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
    const hasAboutPage = bundle.pages.some((page) => /over-ons|over-mij|team|about/i.test(page.finalUrl)) || /wie (we|wij|ik) zijn|over ons|over mij|ons team/i.test(text);
    const hasDirectContact = bundle.pages.some((page) => page.hasPhone) && bundle.pages.some((page) => page.hasEmail);
    const hasCases = /\b(case|cases|portfolio|projecten|resultaat|voorbeelden)\b/i.test(text);
    return scoreChecks({
      key: 'trust',
      label: 'Trust & Autoriteit Audit',
      summary: 'Controleert identiteits-, contact-, juridisch en bewijsgerichte trustsignalen op de gecrawlde website.',
      confidence: 'HIGH',
      checks: [
        { check: 'about', label: 'Wie zit achter het bedrijf', status: hasAboutPage, observed: hasAboutPage ? 'Over-ons/team-signaal gevonden' : 'Niet gevonden', source: 'URL’s en zichtbare content', weight: 18, recommendation: 'Voeg een sterke over-ons-pagina toe met mensen, expertise en werkwijze.' },
        { check: 'direct-contact', label: 'Directe contactgegevens', status: hasDirectContact, observed: `Telefoon ${bundle.pages.some((page) => page.hasPhone) ? 'ja' : 'nee'}, e-mail ${bundle.pages.some((page) => page.hasEmail) ? 'ja' : 'nee'}`, source: 'Zichtbare content en links', weight: 18, recommendation: 'Toon een werkend telefoonnummer en e-mailadres duidelijk op de site.' },
        { check: 'legal', label: 'Juridische transparantie', status: bundle.pages.some((page) => page.hasLegalLinks), observed: bundle.pages.some((page) => page.hasLegalLinks) ? 'Privacy-/voorwaardenlink gevonden' : 'Niet gevonden', source: 'Interne links', weight: 15, recommendation: 'Publiceer minimaal privacy- en cookie-informatie en, waar relevant, voorwaarden en bedrijfsgegevens.' },
        { check: 'testimonials', label: 'Herkenbare klantbewijzen', status: bundle.pages.some((page) => page.hasNamedTestimonials), observed: bundle.pages.some((page) => page.hasNamedTestimonials) ? 'Herkenbare testimonialsignalen gevonden' : 'Niet gevonden', source: 'Gecrawlde DOM', weight: 18, recommendation: 'Gebruik concrete, herleidbare klantquotes met toestemming en context.' },
        { check: 'cases', label: 'Cases of resultaten', status: hasCases, observed: hasCases ? 'Case-/resultaatsignalen gevonden' : 'Niet gevonden', source: 'Zichtbare content', weight: 14, recommendation: 'Laat projecten, aanpak en concrete uitkomsten zien zonder resultaten te garanderen.' },
        { check: 'entity-schema', label: 'Organisatie structured data', status: bundle.pages.some((page) => hasSchema(page, /Organization|LocalBusiness|ProfessionalService/i)), observed: bundle.pages.flatMap((page) => page.schemaTypes).filter((type) => /Organization|LocalBusiness|ProfessionalService/i.test(type)).join(', ') || 'Niet gevonden', source: 'JSON-LD', weight: 12, recommendation: 'Voeg consistente Organization- of LocalBusiness-structured data toe.' },
        { check: 'social-profiles', label: 'Officiële profielen', status: bundle.pages.some((page) => page.hasSocialLinks), observed: bundle.pages.some((page) => page.hasSocialLinks) ? 'Sociale profiellinks gevonden' : 'Niet gevonden', source: 'Externe links', weight: 5, recommendation: 'Link naar actieve officiële profielen en neem ze op als sameAs in schema.' },
      ],
    });
  }
}

export class LocalSEOAuditService {
  analyze(bundle: CrawlBundle): AuditScore {
    const text = allText(bundle);
    const hasLocalTerms = bundle.pages.some((page) => page.hasAddress) || /gevestigd in|werkgebied|actief in|regio|omgeving|route|openingstijden/i.test(text);
    const localLandingPages = bundle.pages.filter((page) => /regio|werkgebied|locatie|vestiging/i.test(`${page.finalUrl} ${page.text}`)).length;
    return scoreChecks({
      key: 'localSeo',
      label: 'Lokale Vindbaarheid Audit',
      summary: 'Meet locatie-, adres-, route- en LocalBusiness-signalen op de website; Google-profielprestaties worden apart als niet geverifieerd gemarkeerd.',
      confidence: 'MEDIUM',
      checks: [
        { check: 'location-context', label: 'Vestiging of werkgebied', status: hasLocalTerms, observed: hasLocalTerms ? 'Adres-/regio-/werkgebiedsignalen gevonden' : 'Niet gevonden', source: 'Zichtbare content', weight: 30, recommendation: 'Noem vestigingsplaats en werkelijk bediende regio’s duidelijk en natuurlijk.' },
        { check: 'address', label: 'Adresgegevens', status: bundle.pages.some((page) => page.hasAddress), observed: bundle.pages.some((page) => page.hasAddress) ? 'Postcode-/adresselement gevonden' : 'Niet gevonden', source: 'Gecrawlde DOM', weight: 20, recommendation: 'Toon bij een fysieke of bezoekbare locatie consistente adresgegevens.' },
        { check: 'local-schema', label: 'LocalBusiness-schema', status: bundle.pages.some((page) => hasSchema(page, /LocalBusiness|ProfessionalService/i)), observed: bundle.pages.flatMap((page) => page.schemaTypes).filter((type) => /LocalBusiness|ProfessionalService/i.test(type)).join(', ') || 'Niet gevonden', source: 'JSON-LD', weight: 22, recommendation: 'Voeg passend LocalBusiness- of ProfessionalService-schema toe met gebied en contact.' },
        { check: 'map-route', label: 'Kaart of route', status: bundle.pages.some((page) => page.hasGoogleMaps) ? true : bundle.pages.some((page) => page.hasAddress) ? false : null, observed: bundle.pages.some((page) => page.hasGoogleMaps) ? 'Google Maps-/routesignaal gevonden' : 'Niet gevonden', source: 'Links en embeds', weight: 12, recommendation: 'Voeg bij een bezoeklocatie een correcte kaart- of routelink toe.' },
        { check: 'local-pages', label: 'Lokale landingscontext', status: localLandingPages > 0, observed: `${localLandingPages} gecrawlde pagina’s met locatie-/werkgebiedcontext`, source: 'URL’s en zichtbare content', weight: 16, recommendation: 'Maak alleen nuttige lokale pagina’s met unieke informatie, cases en dienstverlening per regio.' },
      ],
    });
  }
}

export class AIVisibilityAuditService {
  analyze(bundle: CrawlBundle): AuditScore {
    const text = allText(bundle);
    const schemaCount = bundle.pages.reduce((sum, page) => sum + page.schemaTypes.length, 0);
    const faqCount = bundle.pages.reduce((sum, page) => sum + page.faqCount, 0);
    const aiCrawlerFriendly = bundle.robotsAvailable && !bundle.homepage.hasNoindex;
    return scoreChecks({
      key: 'aiVisibility',
      label: 'AI-vindbaarheid',
      summary: 'Technische en inhoudelijke gereedheid voor AI-systemen; daadwerkelijke vermelding in ChatGPT, Claude of andere modellen kan een crawl niet garanderen.',
      confidence: bundle.homepage.renderMode === 'STATIC_FALLBACK' ? 'LOW' : 'MEDIUM',
      checks: [
        { check: 'crawlable', label: 'Crawlbare basis', status: aiCrawlerFriendly, observed: `Robots ${bundle.robotsAvailable ? 'bereikbaar' : 'ontbreekt'}; noindex ${bundle.homepage.hasNoindex ? 'ja' : 'nee'}`, source: 'robots.txt en meta robots', weight: 20, recommendation: 'Maak belangrijke pagina’s publiek crawlbaar en voorkom onbedoelde noindex/blokkades.' },
        { check: 'entity-schema', label: 'Machineleesbare entiteit', status: bundle.pages.some((page) => hasSchema(page, /Organization|LocalBusiness|ProfessionalService/i)), observed: `${schemaCount} schema-typevermeldingen op gecrawlde pagina’s`, source: 'JSON-LD', weight: 20, recommendation: 'Maak de organisatie en diensten consistent machineleesbaar met gekoppelde structured data.' },
        { check: 'faq', label: 'Citeerbare vraag-antwoorden', status: faqCount >= 4, observed: `${faqCount} FAQ-signalen`, source: 'DOM en JSON-LD', weight: 17, recommendation: 'Beantwoord veelgestelde en koopgerichte vragen kort, feitelijk en zelfstandig.' },
        { check: 'topic-depth', label: 'Thematische diepte', status: bundle.pages.filter((page) => page.wordCount >= 450).length >= 2, observed: `${bundle.pages.filter((page) => page.wordCount >= 450).length} verdiepende pagina’s`, source: 'Zichtbare content', weight: 16, recommendation: 'Bouw inhoudelijke pagina’s rond diensten, doelgroep, kosten, aanpak en regio.' },
        { check: 'identity-statement', label: 'Wie-wat-voor-wie', status: /wij helpen|helpt .{0,50} met|voor ondernemers|voor bedrijven|specialist in|diensten/i.test(text), observed: /wij helpen|voor ondernemers|voor bedrijven|specialist in/i.test(text) ? 'Duidelijke positioneringssignalen gevonden' : 'Niet duidelijk aangetroffen', source: 'Zichtbare content', weight: 14, recommendation: 'Vat in één feitelijk blok samen wie het bedrijf is, wie het helpt, waarmee en waar.' },
        { check: 'proof', label: 'Onderbouwing', status: /bron|onderzoek|case|resultaat|portfolio|review|ervaring/i.test(text), observed: /bron|onderzoek|case|resultaat|portfolio|review|ervaring/i.test(text) ? 'Bewijs-/bronsignalen gevonden' : 'Niet gevonden', source: 'Zichtbare content', weight: 13, recommendation: 'Voeg herleidbare cases, auteurschap, bronnen, expertise en actuele bedrijfsinformatie toe.' },
      ],
    });
  }
}

export class AnalyticsAuditService {
  analyze(bundle: CrawlBundle): AuditScore {
    const providers = Array.from(new Set(bundle.pages.flatMap((page) => page.analyticsProviders)));
    if (!providers.length) {
      return completed({
        key: 'analytics',
        label: 'Analytics & meting',
        score: null,
        status: 'UNKNOWN',
        confidence: 'LOW',
        summary: 'Geen analyticscode aangetroffen; cookietoestemming of server-side tagging kan detectie blokkeren, dus dit wordt niet als bewezen afwezig gescoord.',
        findings: [],
        recommendations: ['Controleer handmatig of GA4/Tag Manager of een privacyvriendelijk alternatief actief is en of contactmomenten als conversie worden gemeten.'],
        evidenceItems: [{ check: 'analytics-provider', label: 'Analyticsprovider', status: 'UNKNOWN', observed: 'Niet zichtbaar in de gerenderde HTML', source: 'Scripts in gecrawlde DOM', weight: 100 }],
        measuredChecks: 0,
        totalChecks: 1,
      });
    }

    return completed({
      key: 'analytics',
      label: 'Analytics & meting',
      score: 75,
      status: 'COMPLETED',
      confidence: 'MEDIUM',
      summary: 'Een analytics- of tagmanagerimplementatie is zichtbaar; correcte events, consent en datakwaliteit zijn zonder accounttoegang niet te verifiëren.',
      findings: [`Gedetecteerd: ${providers.join(', ')}.`],
      recommendations: ['Controleer in het analyticsaccount of formulieren, WhatsApp-, telefoon- en afspraakkliks als conversie-events binnenkomen en consent correct werkt.'],
      evidenceItems: [{ check: 'analytics-provider', label: 'Analyticsprovider', status: 'PASS', observed: providers.join(', '), source: 'Scripts in gecrawlde DOM', weight: 100 }],
      measuredChecks: 1,
      totalChecks: 1,
      evidence: { providers, eventTrackingVerified: false },
    });
  }
}

export class BlogAuditService {
  analyze(bundle: CrawlBundle): AuditScore {
    const blogSignals = bundle.pages.filter((page) => /blog|nieuws|kennis|tips|artikel/i.test(`${page.finalUrl} ${page.text}`)).length;
    const longPages = bundle.pages.filter((page) => page.wordCount >= 700).length;
    return scoreChecks({
      key: 'blog',
      label: 'Blog & kennisbank',
      summary: 'Controleert of de beperkte steekproef informatieve content en voldoende diepgang bevat; publicatiefrequentie is zonder volledige contentfeed niet bewezen.',
      confidence: bundle.sitemapAvailable ? 'MEDIUM' : 'LOW',
      checks: [
        { check: 'blog-presence', label: 'Blog-/kenniscontent', status: blogSignals > 0, observed: `${blogSignals} gecrawlde pagina’s met blog-/kennissignalen`, source: 'URL’s en zichtbare content', weight: 55, recommendation: 'Publiceer behulpzame kenniscontent rond echte klantvragen en zoekintenties.' },
        { check: 'content-depth', label: 'Diepgaande artikelen', status: blogSignals > 0 ? longPages > 0 : false, observed: `${longPages} gecrawlde pagina’s met minimaal 700 woorden`, source: 'Zichtbare content', weight: 30, recommendation: 'Maak artikelen inhoudelijk compleet met voorbeelden, expertise, bronnen en vervolgstappen.' },
        { check: 'crawlable-index', label: 'Vindbare contentstructuur', status: bundle.sitemapAvailable && bundle.sitemapUrlCount > bundle.pages.length, observed: bundle.sitemapAvailable ? `${bundle.sitemapUrlCount} URL’s in sitemap` : 'Geen sitemap gevonden', source: 'sitemap.xml', weight: 15, recommendation: 'Neem canonieke blog-/kennisartikelen op in de XML-sitemap.' },
      ],
    });
  }
}

export class FAQAuditService {
  analyze(bundle: CrawlBundle): AuditScore {
    const faqCount = bundle.pages.reduce((sum, page) => sum + page.faqCount, 0);
    const hasFaqSchema = bundle.pages.some((page) => hasSchema(page, /FAQPage/i));
    const faqPages = bundle.pages.filter((page) => page.faqCount > 0).length;
    return scoreChecks({
      key: 'faq',
      label: 'FAQ Audit',
      summary: 'Controleert zichtbare vragen, spreiding over relevante pagina’s en overeenkomstig FAQPage-schema.',
      confidence: 'HIGH',
      checks: [
        { check: 'faq-volume', label: 'Aantal zichtbare vragen', status: faqCount >= 4, observed: `${faqCount} unieke FAQ-signalen`, source: 'DOM en JSON-LD', weight: 45, recommendation: 'Voeg minstens 4 relevante vragen toe, afgestemd op echte klanttwijfels.' },
        { check: 'faq-spread', label: 'FAQ op relevante pagina’s', status: faqPages >= 2 || (bundle.pages.length <= 2 && faqPages >= 1), observed: `${faqPages} van ${bundle.pages.length} pagina’s bevatten FAQ-signalen`, source: 'Gecrawlde DOM', weight: 25, recommendation: 'Verdeel vragen over de dienstpagina waarop ze inhoudelijk horen.' },
        { check: 'faq-schema', label: 'FAQPage-schema', status: hasFaqSchema, observed: hasFaqSchema ? 'Aanwezig' : 'Niet gevonden', source: 'JSON-LD', weight: 30, recommendation: 'Gebruik geldig FAQPage-schema dat exact overeenkomt met zichtbare vragen en antwoorden.' },
      ],
    });
  }
}

export class BacklinkAuditService {
  analyze(bundle: CrawlBundle): AuditScore {
    return completed({
      key: 'backlink',
      label: 'Backlink Audit',
      score: null,
      status: 'UNKNOWN',
      confidence: 'LOW',
      summary: 'Inkomende links zijn niet uit de eigen website af te leiden; daarom toont de auditor bewust geen backlinkscore op basis van uitgaande links.',
      findings: [],
      recommendations: ['Koppel een betrouwbare backlink-API, bijvoorbeeld Semrush, Ahrefs of Majestic, voor verwijzende domeinen, kwaliteit en verloren links.'],
      evidenceItems: [{ check: 'referring-domains', label: 'Verwijzende domeinen', status: 'UNKNOWN', observed: 'Niet gemeten zonder externe backlinkdatabron', source: 'Geen backlink-API gekoppeld', weight: 100 }],
      measuredChecks: 0,
      totalChecks: 1,
    });
  }
}

export class LeadCaptureAuditService {
  analyze(bundle: CrawlBundle): AuditScore {
    const page = bundle.homepage;
    return scoreChecks({
      key: 'leadCapture',
      label: 'Lead Capture Audit',
      summary: 'Controleert aantoonbare leadroutes; formulierlengte, validatie en opvolgsnelheid zijn zonder interactietest of CRM-toegang niet vastgesteld.',
      confidence: 'MEDIUM',
      checks: [
        { check: 'form', label: 'Contactformulier', status: page.hasContactForm, observed: page.hasContactForm ? 'Formulier met invoervelden gevonden' : 'Niet gevonden op homepage', source: 'Homepage DOM', weight: 30, recommendation: 'Bied een kort, duidelijk formulier met alleen noodzakelijke velden.' },
        { check: 'instant-contact', label: 'Direct contactkanaal', status: page.hasWhatsapp || page.hasPhone, observed: `WhatsApp ${page.hasWhatsapp ? 'ja' : 'nee'}, telefoon ${page.hasPhone ? 'ja' : 'nee'}`, source: 'Homepage links en content', weight: 28, recommendation: 'Bied minstens één direct kanaal zoals telefoon of WhatsApp.' },
        { check: 'appointment', label: 'Afspraakroute', status: page.hasAppointment, observed: page.hasAppointment ? 'Afspraak-/boekingssignaal gevonden' : 'Niet gevonden', source: 'Homepage links en CTA’s', weight: 17, recommendation: 'Overweeg een duidelijke afspraakroute als dit bij het verkoopproces past.' },
        { check: 'cta-repetition', label: 'CTA-herhaling', status: page.ctaCount >= 2, observed: `${page.ctaCount} unieke CTA-teksten`, source: 'Homepage DOM', weight: 15, recommendation: 'Herhaal dezelfde primaire CTA op logische momenten; voorkom concurrerende acties.' },
        { check: 'follow-up', label: 'Opvolging en CRM', status: null, observed: 'Niet verifieerbaar met een websitecrawl', source: 'CRM-/procesdata vereist', weight: 10, recommendation: 'Leg responstijd, leadbron en opvolgstatus vast en stuur op snelle opvolging.' },
      ],
    });
  }
}

export class ContentQualityAuditService {
  analyze(bundle: CrawlBundle): AuditScore {
    const avgWords = Math.round(bundle.pages.reduce((sum, page) => sum + page.wordCount, 0) / bundle.pages.length);
    const usefulHeadings = bundle.pages.reduce((sum, page) => sum + page.headings.h2.length + page.headings.h3.length, 0);
    const thinPages = bundle.pages.filter((page) => page.wordCount < 250).length;
    const images = bundle.pages.flatMap((page) => page.images);
    const imagesWithAlt = images.filter((image) => Boolean(image.alt)).length;
    const duplicatedTitles = bundle.pages.length - new Set(bundle.pages.map((page) => page.title).filter(Boolean)).size;
    return scoreChecks({
      key: 'contentQuality',
      label: 'Content Kwaliteit Audit',
      summary: 'Meet diepte, kopstructuur, duplicatie en alternatieve beeldteksten in de gecrawlde steekproef; inhoudelijke juistheid blijft een redactionele beoordeling.',
      confidence: bundle.pages.length >= 4 ? 'HIGH' : 'MEDIUM',
      checks: [
        { check: 'depth', label: 'Inhoudelijke diepte', status: avgWords >= 350 && thinPages <= Math.floor(bundle.pages.length * 0.25), observed: `Gemiddeld ${avgWords} woorden; ${thinPages} pagina’s onder 250 woorden`, source: 'Zichtbare content', weight: 32, recommendation: 'Breid dunne kernpagina’s uit met eigen uitleg, bewijs, bezwaren, FAQ en vervolgstap.' },
        { check: 'headings', label: 'Scanbare structuur', status: usefulHeadings >= bundle.pages.length * 2, observed: `${usefulHeadings} H2/H3-koppen op ${bundle.pages.length} pagina’s`, source: 'Gecrawlde DOM', weight: 24, recommendation: 'Deel content op met beschrijvende H2/H3-koppen die de zoekvraag volgen.' },
        { check: 'unique-pages', label: 'Unieke pagina-insteek', status: duplicatedTitles === 0, observed: `${duplicatedTitles} ontbrekende of dubbele titels in de steekproef`, source: 'HTML titles', weight: 20, recommendation: 'Geef iedere pagina een unieke intentie, title en inhoud in plaats van dezelfde template-informatie.' },
        { check: 'image-alt', label: 'Alternatieve beeldtekst', status: images.length ? imagesWithAlt / images.length >= 0.8 : null, observed: images.length ? `${imagesWithAlt} van ${images.length} afbeeldingen hebben alt-tekst` : 'Geen afbeeldingen in de steekproef', source: 'img[alt]', weight: 14, recommendation: 'Geef inhoudelijke afbeeldingen een beschrijvende alt-tekst en decoratieve beelden een lege alt.' },
        { check: 'proof-examples', label: 'Voorbeelden en bewijs', status: bundle.pages.some((page) => /case|voorbeeld|resultaat|review|ervaring|onderzoek|bron/i.test(page.text)), observed: bundle.pages.some((page) => /case|voorbeeld|resultaat|review|ervaring|onderzoek|bron/i.test(page.text)) ? 'Bewijs-/voorbeeldsignalen gevonden' : 'Niet gevonden', source: 'Zichtbare content', weight: 10, recommendation: 'Maak claims concreet met voorbeelden, cases, expertise en betrouwbare bronnen.' },
      ],
      evidence: { avgWords, usefulHeadings, thinPages, images: images.length, imagesWithAlt },
    });
  }
}
