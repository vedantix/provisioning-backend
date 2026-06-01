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
  | 'CLARITY';

export type AnalyticsProvisioningError = {
  provider: AnalyticsProviderName;
  code?: string;
  message: string;
  occurredAt: string;
  retryable: boolean;
  attempt?: number;
  nextRetryAt?: string;
  correlationId?: string;
};

export type AnalyticsTimelineEvent = {
  provider: AnalyticsProviderName | 'TRACKING_INJECTION';
  status: AnalyticsProviderStatus;
  message?: string;
  at: string;
  attempt?: number;
  correlationId?: string;
};

export type AnalyticsRetryMetadata = {
  provider: AnalyticsProviderName;
  attempt: number;
  maxAttempts: number;
  nextRetryAt?: string;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  updatedAt: string;
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
  provisioningStatus: AnalyticsProvisioningStatus;
  provisioningErrors: AnalyticsProvisioningError[];
  retryMetadata?: Record<string, AnalyticsRetryMetadata>;
  timeline: AnalyticsTimelineEvent[];
  trackingEnvironment: Record<string, string>;
  dashboardMetrics: AnalyticsDashboardMetricDefinition[];
  activeOperationId?: string;
  activeCorrelationId?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  version?: number;
};

export type AnalyticsProvisionInput = {
  tenantId: string;
  customerId: string;
  deploymentId: string;
  domain: string;
  displayName?: string;
  hostedZoneId?: string;
  actorId?: string;
  requestId?: string;
  idempotencyKey?: string;
  skipAnalyticsLock?: boolean;
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
  provisioningStatus: AnalyticsProvisioningStatus;
  provisioningErrors: AnalyticsProvisioningError[];
  retryMetadata?: Record<string, AnalyticsRetryMetadata>;
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
