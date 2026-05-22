import { beforeAll, describe, expect, it, vi } from 'vitest';

let PreviewService: typeof import('../../../src/modules/preview/services/preview.service').PreviewService;

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
  vi.stubEnv('PUBLIC_PREVIEW_BASE_URL', 'https://www.vedantix.nl');
}

beforeAll(async () => {
  stubRequiredEnv();
  ({ PreviewService } = await import(
    '../../../src/modules/preview/services/preview.service'
  ));
});

describe('PreviewService', () => {
  it('uses the customer domain root label as public preview slug', () => {
    const service = new PreviewService();

    expect(service.buildPreviewSlug('Agni Studio', 'https://www.agni.ag')).toBe('agni');
  });

  it('builds public preview metadata without publishing to the customer domain', () => {
    const service = new PreviewService();

    const preview = service.buildPreviewMetadata({
      companyName: 'De Gouden Kapper',
      domain: 'de-gouden-kapper.nl',
      base44PreviewUrl: 'https://base44.example/apps/preview/123',
    });

    expect(preview).toMatchObject({
      slug: 'de-gouden-kapper',
      path: '/de-gouden-kapper',
      fullUrl: 'https://www.vedantix.nl/de-gouden-kapper',
      targetUrl: 'https://base44.example/apps/preview/123',
      status: 'READY',
    });
  });

  it('uses the public Base44 app instead of the Base44 editor shell', () => {
    const service = new PreviewService();

    const preview = service.buildPreviewMetadata({
      companyName: 'Nature Healing Den Bosch',
      domain: 'naturehealing.nl',
      base44PreviewUrl: 'https://app.base44.com/apps/app_123/editor/preview',
      base44AppName: 'nature-heals-denbosch',
    });

    expect(preview).toMatchObject({
      slug: 'naturehealing',
      path: '/naturehealing',
      fullUrl: 'https://www.vedantix.nl/naturehealing',
      targetUrl: 'https://nature-heals-denbosch.base44.app',
      status: 'READY',
    });
  });

  it('does not use the Base44 editor preview as a safe target', () => {
    const service = new PreviewService();

    expect(
      service.resolvePreviewTargetUrl({
        base44PreviewUrl: 'https://app.base44.com/apps/app_123/editor/preview',
      }),
    ).toBe('');
  });
});
