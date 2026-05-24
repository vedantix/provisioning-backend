export type AnalyticsProviderStatus =
  | 'PENDING'
  | 'PROVISIONED'
  | 'VERIFIED'
  | 'FAILED'
  | 'DELETED'
  | 'SKIPPED';

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
  clarity: ClarityState;
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
  clarity: ClarityState;
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
