import crypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

function stubRuntimeEnv() {
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
  vi.stubEnv('META_MARKETING_TABLE', 'vedantix-meta-marketing-test');
  vi.stubEnv('META_APP_ID', 'meta-app-id');
  vi.stubEnv('META_APP_SECRET', 'meta-app-secret');
  vi.stubEnv('META_TOKEN_ENCRYPTION_SECRET', 'local-test-token-secret');
}

describe('Meta marketing services', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    stubRuntimeEnv();
  });

  it('encrypts Meta OAuth tokens before storage', async () => {
    const { MetaTokenCryptoService } = await import(
      '../../../src/modules/meta-marketing/services/meta-token-crypto.service'
    );
    const service = new MetaTokenCryptoService();

    const encrypted = service.encrypt('long-lived-access-token');

    expect(encrypted).not.toContain('long-lived-access-token');
    expect(service.decrypt(encrypted)).toBe('long-lived-access-token');
  });

  it('calculates profitability dashboard metrics from insights and won leads', async () => {
    const { MetaInsightsService } = await import(
      '../../../src/modules/meta-marketing/services/meta-insights.service'
    );
    const now = new Date('2026-06-01T10:00:00.000Z').toISOString();
    const repository = {
      listByType: vi.fn(async (entityType: string) => {
        if (entityType === 'INSIGHT') {
          return [
            {
              entityType: 'INSIGHT',
              dateStart: '2026-05-30',
              spend: 40,
              leads: 4,
            },
            {
              entityType: 'INSIGHT',
              dateStart: '2026-05-31',
              spend: 60,
              leads: 6,
            },
          ];
        }

        if (entityType === 'LEAD') {
          return [
            {
              entityType: 'LEAD',
              status: 'WON',
              revenue: 300,
              dealValue: 300,
              createdAt: now,
              updatedAt: now,
              wonAt: '2026-05-31T09:00:00.000Z',
            },
            {
              entityType: 'LEAD',
              status: 'QUALIFIED',
              createdAt: now,
              updatedAt: now,
            },
          ];
        }

        if (entityType === 'CAMPAIGN') {
          return [
            { entityType: 'CAMPAIGN', status: 'ACTIVE' },
            { entityType: 'CAMPAIGN', status: 'PAUSED' },
          ];
        }

        return [];
      }),
    };

    const summary = await new MetaInsightsService(repository as any).dashboard();

    expect(summary.spend).toBe(100);
    expect(summary.leads).toBe(10);
    expect(summary.customers).toBe(1);
    expect(summary.revenue).toBe(300);
    expect(summary.profit).toBe(200);
    expect(summary.roas).toBe(3);
    expect(summary.cpl).toBe(10);
    expect(summary.cac).toBe(100);
    expect(summary.activeCampaigns).toBe(1);
    expect(summary.charts.profit).toContainEqual({ date: '2026-05-31', value: 240 });
    expect(summary.charts.roas).toContainEqual({ date: '2026-05-31', value: 5 });
  });

  it('validates signed Meta lead webhooks before ingestion', async () => {
    const { MetaWebhookService } = await import(
      '../../../src/modules/meta-marketing/services/meta-webhook.service'
    );
    const leadService = {
      ingestLeadgenId: vi.fn(async () => ({})),
    };
    const service = new MetaWebhookService(leadService as any);
    const rawBody = Buffer.from(JSON.stringify({
      object: 'page',
      entry: [
        {
          changes: [
            {
              field: 'leadgen',
              value: { leadgen_id: 'leadgen-123' },
            },
          ],
        },
      ],
    }));
    const signature = `sha256=${crypto
      .createHmac('sha256', 'meta-app-secret')
      .update(rawBody)
      .digest('hex')}`;

    await expect(service.handle({
      tenantId: 'default',
      payload: JSON.parse(rawBody.toString('utf8')),
      rawBody,
      signature,
    })).resolves.toEqual({ processed: 1 });

    expect(leadService.ingestLeadgenId).toHaveBeenCalledWith({
      tenantId: 'default',
      actorId: 'meta-webhook',
      leadgenId: 'leadgen-123',
    });
  });
});
