import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

let AnalyticsProvisionService: typeof import('../../../src/services/analytics/analytics-provision.service').AnalyticsProvisionService;
let AppError: typeof import('../../../src/errors/app-error').AppError;

function stubRequiredEnv() {
  vi.stubEnv('AWS_REGION', 'eu-west-1');
  vi.stubEnv('AWS_ACM_REGION', 'us-east-1');
  vi.stubEnv('AWS_ROUTE53_HOSTED_ZONE_ID', 'ZTEST');
  vi.stubEnv('GITHUB_OWNER', 'vedantix');
  vi.stubEnv('GITHUB_TOKEN', 'test-token');
  vi.stubEnv('PROVISIONING_API_KEY', 'test-api-key');
  vi.stubEnv('SQS_QUEUE_URL', 'https://sqs.eu-west-1.amazonaws.com/123/test');
  vi.stubEnv('CUSTOMERS_TABLE', 'vedantix-customers-test');
  vi.stubEnv('DEPLOYMENTS_TABLE', 'vedantix-deployments-test');
  vi.stubEnv('JOBS_TABLE', 'vedantix-jobs-test');
  vi.stubEnv('ANALYTICS_INTEGRATIONS_TABLE', 'analytics-integrations-test');
  vi.stubEnv('GOOGLE_ANALYTICS_ACCOUNT_ID', '123456');
  vi.stubEnv('GOOGLE_CLIENT_ID', 'google-client-id');
  vi.stubEnv('GOOGLE_CLIENT_SECRET', 'google-client-secret');
  vi.stubEnv('GOOGLE_REFRESH_TOKEN', 'google-refresh-token');
  vi.stubEnv('GOOGLE_ADS_DEVELOPER_TOKEN', 'google-ads-dev-token');
  vi.stubEnv('GOOGLE_ADS_CUSTOMER_ID', '1234567890');
}

function buildService(overrides: Record<string, unknown> = {}) {
  const store = new Map<string, any>();
  const repository = {
    getByCustomerId: vi.fn(async (customerId: string) => store.get(customerId) ?? null),
    upsert: vi.fn(async (record: any) => {
      store.set(record.customerId, record);
    }),
  };
  const googleAnalytics = {
    reconcileProperty: vi.fn(async () => ({
      propertyId: '123456',
      propertyName: 'properties/123456',
      dataStreamId: '789',
      dataStreamName: 'properties/123456/dataStreams/789',
      measurementId: 'G-ABC123',
    })),
    deleteProperty: vi.fn(async () => undefined),
  };
  const searchConsole = {
    reconcileProperty: vi.fn(async () => ({
      propertyId: 'sc-domain:jitan-sports.nl',
      verificationToken: 'google-site-verification=test-token',
      verificationRecordName: 'jitan-sports.nl',
      verified: true,
    })),
    deleteProperty: vi.fn(async () => undefined),
  };
  const clarity = {
    reconcileProject: vi.fn(async () => ({
      projectId: 'clarity123',
      trackingCode: 'clarity-code',
    })),
    getTrackingCode: vi.fn((projectId: string) => `clarity-${projectId}`),
    deleteProject: vi.fn(async () => undefined),
  };
  const audit = {
    write: vi.fn(async () => undefined),
  };
  const googleAds = {
    reconcileConversions: vi.fn(async () => ({
      customerId: '1234567890',
      conversionId: '1234567890',
      conversions: [
        {
          event: 'LEAD',
          conversionActionId: '100',
          conversionActionResourceName: 'customers/1234567890/conversionActions/100',
          conversionId: '1234567890',
          conversionLabel: 'leadLabel',
          conversionName: 'Jitan Sports - Lead',
          status: 'SUCCEEDED',
        },
      ],
    })),
    buildTrackingEnvironment: vi.fn((result: any) => ({
      VITE_GOOGLE_ADS_CONVERSION_ID: result.conversionId,
      NEXT_PUBLIC_GOOGLE_ADS_CONVERSION_ID: result.conversionId,
      VITE_GOOGLE_ADS_CONVERSION_LABELS: '{"LEAD":"leadLabel"}',
      NEXT_PUBLIC_GOOGLE_ADS_CONVERSION_LABELS: '{"LEAD":"leadLabel"}',
    })),
  };

  return {
    store,
    repository,
    googleAnalytics,
    searchConsole,
    googleAds,
    clarity,
    service: new AnalyticsProvisionService(
      (overrides.repository || repository) as any,
      (overrides.googleAnalytics || googleAnalytics) as any,
      (overrides.searchConsole || searchConsole) as any,
      (overrides.clarity || clarity) as any,
      audit as any,
      (overrides.googleAds || googleAds) as any,
    ),
  };
}

beforeAll(async () => {
  stubRequiredEnv();
  ({ AnalyticsProvisionService } = await import(
    '../../../src/services/analytics/analytics-provision.service'
  ));
  ({ AppError } = await import('../../../src/errors/app-error'));
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AnalyticsProvisionService', () => {
  it('provisions Google Analytics, Search Console and Clarity idempotently', async () => {
    const { service, googleAnalytics, searchConsole, googleAds, clarity } = buildService();

    const result = await service.provisionAnalytics({
      tenantId: 'default',
      customerId: 'cust_1',
      deploymentId: 'dep_1',
      domain: 'jitan-sports.nl',
      hostedZoneId: 'Z123',
      displayName: 'Jitan Sports',
    });

    expect(result.googleAnalytics).toMatchObject({
      propertyId: '123456',
      measurementId: 'G-ABC123',
      status: 'SUCCEEDED',
    });
    expect(result.searchConsole).toMatchObject({
      propertyId: 'sc-domain:jitan-sports.nl',
      verified: true,
      status: 'SUCCEEDED',
    });
    expect(result.googleAds).toMatchObject({
      customerId: '1234567890',
      conversionId: '1234567890',
      status: 'SUCCEEDED',
    });
    expect(result.clarity).toMatchObject({
      projectId: 'clarity123',
      status: 'SUCCEEDED',
    });
    expect(result.trackingEnvironment).toMatchObject({
      VITE_GA_MEASUREMENT_ID: 'G-ABC123',
      NEXT_PUBLIC_GA_MEASUREMENT_ID: 'G-ABC123',
      VITE_CLARITY_PROJECT_ID: 'clarity123',
      NEXT_PUBLIC_CLARITY_PROJECT_ID: 'clarity123',
      VITE_GOOGLE_ADS_CONVERSION_ID: '1234567890',
    });

    await service.provisionAnalytics({
      tenantId: 'default',
      customerId: 'cust_1',
      deploymentId: 'dep_1',
      domain: 'jitan-sports.nl',
      hostedZoneId: 'Z123',
      displayName: 'Jitan Sports',
    });

    expect(googleAnalytics.reconcileProperty).toHaveBeenCalledTimes(1);
    expect(searchConsole.reconcileProperty).toHaveBeenCalledTimes(1);
    expect(googleAds.reconcileConversions).toHaveBeenCalledTimes(1);
    expect(clarity.reconcileProject).toHaveBeenCalledTimes(1);
  });

  it('allows Clarity to be skipped when no supported project API is configured', async () => {
    const clarity = {
      reconcileProject: vi.fn(async () => ({
        skipped: true,
        reason: 'Clarity API not configured',
      })),
      getTrackingCode: vi.fn(),
      deleteProject: vi.fn(),
    };
    const { service } = buildService({ clarity });

    const result = await service.provisionAnalytics({
      tenantId: 'default',
      customerId: 'cust_2',
      deploymentId: 'dep_2',
      domain: 'example.nl',
      hostedZoneId: 'Z123',
    });

    expect(result.clarity).toMatchObject({
      status: 'SKIPPED',
      errorMessage: 'Clarity API not configured',
    });
    expect(result.trackingEnvironment).not.toHaveProperty('VITE_CLARITY_PROJECT_ID');
  });

  it('fails Google providers when credentials are not configured', async () => {
    const googleAnalytics = {
      reconcileProperty: vi.fn(async () => {
        throw new AppError(
          'GOOGLE_ANALYTICS_ACCOUNT_ID is not configured',
          500,
          'GOOGLE_ANALYTICS_CONFIG',
        );
      }),
      deleteProperty: vi.fn(),
    };
    const searchConsole = {
      reconcileProperty: vi.fn(async () => {
        throw new AppError(
          'Google service account credentials are not configured',
          500,
          'GOOGLE_AUTH_CONFIG',
        );
      }),
      deleteProperty: vi.fn(),
    };
    const { service } = buildService({ googleAnalytics, searchConsole });

    await expect(
      service.provisionAnalytics({
        tenantId: 'default',
        customerId: 'cust_optional_google',
        deploymentId: 'dep_optional_google',
        domain: 'optional-google.nl',
        hostedZoneId: 'Z123',
      }),
    ).rejects.toThrow('GOOGLE_ANALYTICS_ACCOUNT_ID is not configured');
  });

  it('marks provider records as deleted during cleanup', async () => {
    const { service, googleAnalytics, searchConsole, clarity } = buildService();

    await service.provisionAnalytics({
      tenantId: 'default',
      customerId: 'cust_3',
      deploymentId: 'dep_3',
      domain: 'cleanup.nl',
      hostedZoneId: 'Z123',
    });

    const deleted = await service.deleteAnalytics({
      tenantId: 'default',
      customerId: 'cust_3',
    });

    expect(deleted?.googleAnalytics.status).toBe('DELETED');
    expect(deleted?.searchConsole.status).toBe('DELETED');
    expect(deleted?.clarity.status).toBe('DELETED');
    expect(googleAnalytics.deleteProperty).toHaveBeenCalledWith('123456');
    expect(searchConsole.deleteProperty).toHaveBeenCalledWith('sc-domain:jitan-sports.nl');
    expect(clarity.deleteProject).toHaveBeenCalledWith('clarity123');
  });
});
