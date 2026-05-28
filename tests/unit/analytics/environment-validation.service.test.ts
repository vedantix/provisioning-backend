import { beforeEach, describe, expect, it, vi } from 'vitest';

async function loadService() {
  vi.resetModules();
  return import('../../../src/services/analytics/environment-validation.service');
}

function stubBaseEnv() {
  vi.stubEnv('GOOGLE_ANALYTICS_ACCOUNT_ID', '123456');
  vi.stubEnv('GOOGLE_CLIENT_ID', 'client-id');
  vi.stubEnv('GOOGLE_CLIENT_SECRET', 'client-secret');
  vi.stubEnv('GOOGLE_REFRESH_TOKEN', 'refresh-token');
  vi.stubEnv('GOOGLE_ADS_DEVELOPER_TOKEN', 'dev-token');
  vi.stubEnv('GOOGLE_ADS_CUSTOMER_ID', '1234567890');
}

function stubRequiredRuntimeEnv() {
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
}

describe('EnvironmentValidationService', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    stubRequiredRuntimeEnv();
  });

  it('keeps the API online when marketing settings are missing by default', async () => {
    vi.stubEnv('GOOGLE_ADS_DEVELOPER_TOKEN', 'dev-token');
    vi.stubEnv('GOOGLE_ADS_CUSTOMER_ID', '1234567890');
    const { EnvironmentValidationService } = await loadService();

    expect(() => new EnvironmentValidationService().validateStartup()).not.toThrow();
  });

  it('fails startup when strict marketing validation is enabled', async () => {
    vi.stubEnv('MARKETING_STACK_STRICT_STARTUP', 'true');
    vi.stubEnv('GOOGLE_ADS_DEVELOPER_TOKEN', 'dev-token');
    vi.stubEnv('GOOGLE_ADS_CUSTOMER_ID', '1234567890');
    const { EnvironmentValidationService } = await loadService();

    expect(() => new EnvironmentValidationService().validateStartup()).toThrow(
      'Marketing stack environment is incomplete',
    );
  });

  it('accepts encrypted OAuth credentials from Secrets Manager', async () => {
    vi.stubEnv('GOOGLE_ANALYTICS_ACCOUNT_ID', '123456');
    vi.stubEnv('GOOGLE_OAUTH_SECRET_ARN', 'arn:aws:secretsmanager:eu-west-1:123:secret:google');
    vi.stubEnv('GOOGLE_ADS_DEVELOPER_TOKEN', 'dev-token');
    vi.stubEnv('GOOGLE_ADS_CUSTOMER_ID', '1234567890');
    const { EnvironmentValidationService } = await loadService();

    const result = new EnvironmentValidationService().validateMarketingStackEnvironment();

    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it('passes startup when all direct environment variables are present', async () => {
    stubBaseEnv();
    const { EnvironmentValidationService } = await loadService();

    expect(() => new EnvironmentValidationService().validateStartup()).not.toThrow();
  });
});
