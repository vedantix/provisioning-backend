import type {
  AnalyticsProviderStatus,
  GoogleAnalyticsState,
} from './analytics.types';

export type GoogleAnalyticsProvisioningStatus = AnalyticsProviderStatus;

export type GoogleAnalyticsProvisioningRecord = {
  customerId: string;
  tenantId: string;
  deploymentId?: string;
  domain?: string;
  accountId?: string;
  propertyId?: string;
  propertyName?: string;
  streamId?: string;
  streamName?: string;
  measurementId?: string;
  provisioningStatus: AnalyticsProviderStatus;
  provisioningErrors: string[];
  createdAt?: string;
  updatedAt?: string;
};

export function toGoogleAnalyticsProvisioningRecord(input: {
  customerId: string;
  tenantId: string;
  deploymentId?: string;
  domain?: string;
  accountId?: string;
  state: GoogleAnalyticsState;
  createdAt?: string;
  updatedAt?: string;
}): GoogleAnalyticsProvisioningRecord {
  return {
    customerId: input.customerId,
    tenantId: input.tenantId,
    deploymentId: input.deploymentId,
    domain: input.domain,
    accountId: input.accountId,
    propertyId: input.state.propertyId,
    propertyName: input.state.propertyName,
    streamId: input.state.dataStreamId,
    streamName: input.state.dataStreamName,
    measurementId: input.state.measurementId,
    provisioningStatus: input.state.status,
    provisioningErrors: input.state.errorMessage ? [input.state.errorMessage] : [],
    createdAt: input.createdAt,
    updatedAt: input.state.updatedAt || input.updatedAt,
  };
}
