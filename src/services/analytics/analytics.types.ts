export type AnalyticsProvisioningStatus =
  | 'NOT_STARTED'
  | 'PENDING'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'RETRYING'
  | 'FAILED'
  | 'DISCONNECTED';

export type AnalyticsProviderStatus =
  | AnalyticsProvisioningStatus
  | 'PROVISIONED'
  | 'VERIFIED'
  | 'DELETED'
  | 'SKIPPED';

export type AnalyticsProviderName =
  | 'GOOGLE_ANALYTICS'
  | 'SEARCH_CONSOLE'
  | 'GOOGLE_ADS'
  | 'CLARITY';

export type AnalyticsProvisioningError = {
  provider: AnalyticsProviderName;
  code?: string;
  message: string;
  occurredAt: string;
  retryable: boolean;
  attempt?: number;
};

export type AnalyticsTimelineEvent = {
  provider: AnalyticsProviderName | 'TRACKING_INJECTION';
  status: AnalyticsProviderStatus;
  message?: string;
  at: string;
};

export type GoogleAnalyticsState = {
  propertyId?: string;
  propertyName?: string;
  dataStreamId?: string;
  dataStreamName?: string;
  measurementId?: string;
  status: AnalyticsProviderStatus;
  errorMessage?: string;
  updatedAt?: string;
};

export type SearchConsoleState = {
  propertyId?: string;
  verificationToken?: string;
  verificationRecordName?: string;
  verificationRecordType?: 'TXT';
  verified: boolean;
  status: AnalyticsProviderStatus;
  errorMessage?: string;
  updatedAt?: string;
};

export type GoogleAdsConversionEvent =
  | 'LEAD'
  | 'WHATSAPP_CLICK'
  | 'CONTACT_FORM'
  | 'BOOKING'
  | 'PURCHASE';

export type GoogleAdsConversionState = {
  event: GoogleAdsConversionEvent;
  conversionActionId?: string;
  conversionActionResourceName?: string;
  conversionId?: string;
  conversionLabel?: string;
  conversionName: string;
  status: AnalyticsProviderStatus;
  globalSiteTag?: string;
  eventSnippet?: string;
  updatedAt?: string;
  errorMessage?: string;
};

export type GoogleAdsState = {
  customerId?: string;
  conversionId?: string;
  conversions: GoogleAdsConversionState[];
  enhancedConversionsEnabled: boolean;
  status: AnalyticsProviderStatus;
  errorMessage?: string;
  updatedAt?: string;
};

export type ClarityState = {
  projectId?: string;
  trackingCode?: string;
  status: AnalyticsProviderStatus;
  errorMessage?: string;
  updatedAt?: string;
};

export type AnalyticsDashboardMetricDefinition = {
  key: string;
  provider: 'GOOGLE_ANALYTICS' | 'SEARCH_CONSOLE' | 'CLARITY' | 'VEDANTIX';
  description: string;
};

export type AnalyticsIntegrationRecord = {
  customerId: string;
  tenantId: string;
  deploymentId: string;
  domain: string;
  normalizedDomain: string;
  googleAnalytics: GoogleAnalyticsState;
  searchConsole: SearchConsoleState;
  googleAds: GoogleAdsState;
  clarity: ClarityState;
  provisioningStatus: AnalyticsProvisioningStatus;
  provisioningErrors: AnalyticsProvisioningError[];
  timeline: AnalyticsTimelineEvent[];
  trackingEnvironment: Record<string, string>;
  dashboardMetrics: AnalyticsDashboardMetricDefinition[];
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
};

export type AnalyticsProvisionInput = {
  tenantId: string;
  customerId: string;
  deploymentId: string;
  domain: string;
  displayName?: string;
  hostedZoneId?: string;
  actorId?: string;
};

export type AnalyticsDeleteInput = {
  tenantId: string;
  customerId: string;
  deploymentId?: string;
  actorId?: string;
};

export type AnalyticsRepairInput = AnalyticsProvisionInput;

export type AnalyticsStatusResult = {
  customerId: string;
  deploymentId?: string;
  domain?: string;
  googleAnalytics: GoogleAnalyticsState;
  searchConsole: SearchConsoleState;
  googleAds: GoogleAdsState;
  clarity: ClarityState;
  provisioningStatus: AnalyticsProvisioningStatus;
  provisioningErrors: AnalyticsProvisioningError[];
  timeline: AnalyticsTimelineEvent[];
  trackingEnvironment: Record<string, string>;
  ready: boolean;
};

export type GoogleAnalyticsPropertyResult = {
  propertyId: string;
  propertyName: string;
};

export type GoogleAnalyticsDataStreamResult = {
  dataStreamId: string;
  dataStreamName: string;
  measurementId: string;
};

export type SearchConsoleProvisionResult = {
  propertyId: string;
  verificationToken: string;
  verificationRecordName: string;
  verified: boolean;
};

export type ClarityProvisionResult = {
  projectId?: string;
  trackingCode?: string;
  skipped?: boolean;
  reason?: string;
};

export type GoogleAdsProvisionResult = {
  customerId: string;
  conversionId?: string;
  conversions: GoogleAdsConversionState[];
};
