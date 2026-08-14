export type AuditStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export type AuditModuleStatus = 'COMPLETED' | 'UNKNOWN' | 'FAILED';

export type AuditConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export type AuditCheckStatus = 'PASS' | 'FAIL' | 'UNKNOWN';

export type AuditEvidenceItem = {
  check: string;
  label: string;
  status: AuditCheckStatus;
  observed: string;
  source: string;
  weight: number;
  url?: string;
};

export type AuditPriority = 'CRITICAL' | 'IMPORTANT' | 'OPTIMIZATION';

export type AuditCategoryKey =
  | 'seo'
  | 'geo'
  | 'aeo'
  | 'aio'
  | 'performance'
  | 'analytics'
  | 'blog'
  | 'faq'
  | 'backlink'
  | 'googleBusiness'
  | 'reviews'
  | 'conversion'
  | 'security'
  | 'trust'
  | 'leadCapture'
  | 'localSeo'
  | 'contentQuality'
  | 'aiVisibility';

export type AuditScore = {
  key: AuditCategoryKey;
  label: string;
  score: number | null;
  status: AuditModuleStatus;
  confidence: AuditConfidence;
  summary: string;
  findings: string[];
  recommendations: string[];
  evidenceItems: AuditEvidenceItem[];
  measuredChecks: number;
  totalChecks: number;
  evidence?: Record<string, unknown>;
};

export type AuditRequest = {
  id: string;
  tenantId: string;
  name: string;
  companyName: string;
  email: string;
  websiteUrl: string;
  competitorUrl1?: string;
  competitorUrl2?: string;
  status: AuditStatus;
  createdDate: string;
  updatedDate: string;
  completedDate?: string;
  errorMessage?: string;
};

export type CompetitorAuditSummary = {
  url: string;
  status: 'COMPLETED' | 'PARTIAL' | 'FAILED';
  seoScore: number | null;
  reviewSignals: number | null;
  faqCount: number | null;
  speedScore: number | null;
  googleBusinessSignals: number | null;
  conversionSignals: number | null;
  pagesAnalyzed: number;
  errorMessage?: string;
};

export type AuditResult = {
  auditRequestId: string;
  tenantId: string;
  seoScore: number | null;
  geoScore: number | null;
  aeoScore: number | null;
  aioScore: number | null;
  performanceScore: number | null;
  securityScore: number | null;
  googleBusinessScore: number | null;
  reviewScore: number | null;
  conversionScore: number | null;
  trustScore: number | null;
  localSeoScore: number | null;
  aiVisibilityScore: number | null;
  overallScore: number | null;
  overallConfidence: AuditConfidence;
  measuredWeightPercent: number;
  auditedUrl: string;
  finalUrl: string;
  pagesAnalyzed: number;
  renderedPages: number;
  auditVersion: string;
  limitations: string[];
  executiveSummary: string;
  quickWins: string[];
  recommendations: string[];
  priorityMatrix: Record<AuditPriority, string[]>;
  scores: AuditScore[];
  competitors: CompetitorAuditSummary[];
  pdfPath: string;
  createdDate: string;
};

export type AuditRecord =
  | ({
      pk: string;
      sk: 'REQUEST';
      entityType: 'AUDIT_REQUEST';
    } & AuditRequest)
  | ({
      pk: string;
      sk: 'RESULT';
      entityType: 'AUDIT_RESULT';
    } & AuditResult);

export type StartAuditInput = {
  tenantId: string;
  name: string;
  companyName: string;
  email: string;
  websiteUrl: string;
  competitorUrl1?: string;
  competitorUrl2?: string;
};

export type CrawledPage = {
  url: string;
  finalUrl: string;
  statusCode: number;
  responseTimeMs: number;
  bodyBytes: number;
  renderMode: 'STATIC_HTML' | 'BROWSER_RENDERED' | 'STATIC_FALLBACK';
  headers: Record<string, string>;
  title?: string;
  metaDescription?: string;
  canonical?: string;
  headings: {
    h1: string[];
    h2: string[];
    h3: string[];
  };
  text: string;
  wordCount: number;
  links: string[];
  images: Array<{ src: string; alt?: string }>;
  schemaTypes: string[];
  invalidSchemaCount: number;
  faqSchemaCount: number;
  hasNoindex: boolean;
  faqCount: number;
  ctaCount: number;
  hasContactForm: boolean;
  hasPhone: boolean;
  hasWhatsapp: boolean;
  hasAppointment: boolean;
  hasReviews: boolean;
  hasTestimonials: boolean;
  hasGoogleMaps: boolean;
  hasAnalytics: boolean;
  analyticsProviders: string[];
  hasAddress: boolean;
  hasEmail: boolean;
  hasLegalLinks: boolean;
  hasSocialLinks: boolean;
  hasReviewPlatformLink: boolean;
  hasNamedTestimonials: boolean;
  hasRobotsTxt: boolean;
  hasSitemapXml: boolean;
};

export type CrawlBundle = {
  requestedUrl: string;
  normalizedUrl: string;
  host: string;
  domain: string;
  homepage: CrawledPage;
  pages: CrawledPage[];
  robotsAvailable: boolean;
  sitemapAvailable: boolean;
  sitemapUrlCount: number;
  llmsTxtAvailable: boolean;
  spfPresent: boolean;
  dmarcPresent: boolean;
  crawlWarnings: string[];
  pagesAttempted: number;
};
