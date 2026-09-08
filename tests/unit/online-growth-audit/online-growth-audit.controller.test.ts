import type { Request, Response } from 'express';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { AuditRequest } from '../../../src/modules/online-growth-audit/types/online-growth-audit.types';
import type { OnlineGrowthAuditService } from '../../../src/modules/online-growth-audit/services/online-growth-audit.service';

process.env.NODE_ENV = 'test';
process.env.AWS_REGION = 'eu-west-1';
process.env.AWS_ACM_REGION = 'us-east-1';
process.env.AWS_ROUTE53_HOSTED_ZONE_ID = 'ZTEST';
process.env.GITHUB_OWNER = 'vedantix';
process.env.GITHUB_TOKEN = 'test-token';
process.env.PROVISIONING_API_KEY = 'test-api-key';
process.env.SQS_QUEUE_URL = 'https://sqs.eu-west-1.amazonaws.com/123456789012/test';
process.env.CUSTOMERS_TABLE = 'test-customers';
process.env.DEPLOYMENTS_TABLE = 'test-deployments';
process.env.JOBS_TABLE = 'test-jobs';

type OnlineGrowthAuditControllerConstructor =
  typeof import('../../../src/modules/online-growth-audit/controllers/online-growth-audit.controller').OnlineGrowthAuditController;

let OnlineGrowthAuditController: OnlineGrowthAuditControllerConstructor;

beforeAll(async () => {
  ({ OnlineGrowthAuditController } = await import(
    '../../../src/modules/online-growth-audit/controllers/online-growth-audit.controller'
  ));
});

describe('OnlineGrowthAuditController public detail', () => {
  it('does not expose name, email or tenant id in the public request payload', async () => {
    const auditRequest: AuditRequest = {
      id: '11111111-1111-4111-8111-111111111111',
      tenantId: 'default',
      name: 'Sensitive Name',
      companyName: 'Example Company',
      email: 'private@example.com',
      websiteUrl: 'https://example.com/',
      status: 'COMPLETED',
      createdDate: '2026-09-08T10:00:00.000Z',
      updatedDate: '2026-09-08T10:05:00.000Z',
      completedDate: '2026-09-08T10:05:00.000Z',
    };

    const service = {
      getAudit: vi.fn().mockResolvedValue({ request: auditRequest, results: null }),
    } as unknown as OnlineGrowthAuditService;
    const controller = new OnlineGrowthAuditController(service);

    const req = {
      params: { id: auditRequest.id },
      ctx: { tenantId: 'default', requestId: 'request-1' },
    } as unknown as Request;
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const res = { status } as unknown as Response;

    await controller.detail(req, res);

    expect(status).toHaveBeenCalledWith(200);
    const payload = json.mock.calls[0][0];
    expect(payload.data.request).toMatchObject({
      companyName: 'Example Company',
      websiteUrl: 'https://example.com/',
    });
    expect(payload.data.request).not.toHaveProperty('name');
    expect(payload.data.request).not.toHaveProperty('email');
    expect(payload.data.request).not.toHaveProperty('tenantId');
  });
});
