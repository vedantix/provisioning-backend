export type AuditStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export type AuditModuleStatus = 'COMPLETED' | 'UNKNOWN' | 'FAILED';

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
  summary: string;
  findings: string[];
  recommendations: string[];
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
  seoScore: number | null;
  reviewSignals: number;
  faqCount: number;
  speedScore: number | null;
  googleBusinessSignals: number;
  conversionSignals: number;
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
  spfPresent: boolean;
  dmarcPresent: boolean;
};
