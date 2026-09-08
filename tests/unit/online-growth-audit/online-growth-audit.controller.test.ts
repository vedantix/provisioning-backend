import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { OnlineGrowthAuditController } from '../../src/modules/online-growth-audit/controllers/online-growth-audit.controller';
import { OnlineGrowthAuditService } from '../../src/modules/online-growth-audit/services/online-growth-audit.service';
import type { AuditRequest } from '../../src/modules/online-growth-audit/types/online-growth-audit.types';

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
