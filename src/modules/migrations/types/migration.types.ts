export type MigrationStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'ANALYZED'
  | 'IMPROVING'
  | 'READY_FOR_IMPORT'
  | 'IMPORTED'
  | 'FAILED';

export type MigrationEntityType = 'MIGRATION' | 'PAGE' | 'IMAGE' | 'REPORT';

export interface MigrationBaseRecord {
  pk: string;
  sk: string;
  entityType: MigrationEntityType;
  tenantId: string;
  migrationId: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  updatedBy?: string;
  deletedAt?: string;
}

export interface MigrationRecord extends MigrationBaseRecord {
  entityType: 'MIGRATION';
  customerId: string;
  customerName?: string;
  sourceUrl: string;
  targetUrl?: string;
  industry?: string;
  status: MigrationStatus;
  progress: number;
  startedAt?: string;
  completedAt?: string;
  lastError?: string;
  counts: {
    pages: number;
    images: number;
    faqs: number;
    testimonials: number;
    ctas: number;
  };
  seoScore: number;
  coverageScore: number;
  aiStatus?: 'NOT_STARTED' | 'NOT_CONFIGURED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  importStatus?: 'NOT_STARTED' | 'READY' | 'IMPORTED' | 'FAILED';
  reportId?: string;
  importPayload?: MigrationImportPayload;
}

export interface ExtractedImage {
  imageUrl: string;
  altText?: string;
  sourcePageUrl?: string;
}

export interface ExtractedFaq {
  question: string;
  answer?: string;
}

export interface ExtractedCta {
  label: string;
  href?: string;
  context?: string;
}

export interface ExtractedTestimonial {
  quote: string;
  author?: string;
}

export interface ExtractedSection {
  heading?: string;
  body: string;
}

export interface PageImprovement {
  heroTitle?: string;
  heroSubtitle?: string;
  improvedSections: ExtractedSection[];
  improvedSeoTitle?: string;
  improvedSeoDescription?: string;
  recommendedCtas: ExtractedCta[];
  notes: string[];
}

export interface MigrationPageRecord extends MigrationBaseRecord {
  entityType: 'PAGE';
  pageId: string;
  pageUrl: string;
  pathname: string;
  pageType: string;
  title?: string;
  description?: string;
  canonicalUrl?: string;
  h1?: string;
  headings: string[];
  wordCount: number;
  sections: ExtractedSection[];
  images: ExtractedImage[];
  faqs: ExtractedFaq[];
  ctas: ExtractedCta[];
  testimonials: ExtractedTestimonial[];
  seoScore: number;
  contentCoverage: number;
  missingContent: string[];
  aiImprovement?: PageImprovement;
}

export interface MigrationImageRecord extends MigrationBaseRecord {
  entityType: 'IMAGE';
  imageId: string;
  imageUrl: string;
  altText?: string;
  sourcePageUrl?: string;
}

export interface MigrationReportData {
  executiveSummary: string;
  sourceUrl: string;
  targetUrl?: string;
  totals: MigrationRecord['counts'];
  seoScore: number;
  coverageScore: number;
  missingContent: string[];
  pages: Array<{
    pageId: string;
    pageUrl: string;
    pageType: string;
    title?: string;
    seoScore: number;
    contentCoverage: number;
    missingContent: string[];
  }>;
  images: ExtractedImage[];
  recommendations: string[];
  generatedAt: string;
}

export interface MigrationReportRecord extends MigrationBaseRecord {
  entityType: 'REPORT';
  reportId: string;
  reportData: MigrationReportData;
}

export interface MigrationImportPayload {
  generatedAt: string;
  sourceUrl: string;
  targetUrl?: string;
  pages: Array<{
    slug: string;
    title: string;
    hero: {
      title: string;
      subtitle?: string;
    };
    sections: ExtractedSection[];
    faqs: ExtractedFaq[];
    ctas: ExtractedCta[];
    seo: {
      title: string;
      description: string;
      openGraphTitle: string;
      openGraphDescription: string;
    };
  }>;
}

export interface StartMigrationInput {
  tenantId: string;
  actorId: string;
  customerId: string;
  customerName?: string;
  sourceUrl: string;
  targetUrl?: string;
  industry?: string;
}
