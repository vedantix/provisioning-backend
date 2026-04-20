import type { Request, Response } from 'express';
import { env } from '../../../config/env';
import { CustomersService } from '../../customers/services/customers.service';
import { ContentSyncService } from '../../content-sync/services/content-sync.service';
import type { ContentSyncFileInput } from '../../content-sync/types/content-sync.types';

function getSecretFromRequest(req: Request): string {
  const value =
    req.headers['x-base44-webhook-secret'] ||
    req.headers['x-webhook-secret'] ||
    req.headers['authorization'];

  if (Array.isArray(value)) {
    return String(value[0] || '').replace(/^Bearer\s+/i, '').trim();
  }

  return String(value || '').replace(/^Bearer\s+/i, '').trim();
}

function parseAdditionalFiles(value: unknown): ContentSyncFileInput[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item): ContentSyncFileInput => ({
      path: String(item.path || ''),
      content: String(item.content || ''),
      encoding: item.encoding === 'base64' ? 'base64' : 'utf-8',
    }))
    .filter((item) => item.path.length > 0);
}

export class Base44WebhookController {
  constructor(
    private readonly customersService = new CustomersService(),
    private readonly contentSyncService = new ContentSyncService(),
  ) {}

  receiveExport = async (req: Request, res: Response): Promise<void> => {
    if (!env.base44ExportWebhookSecret) {
      res.status(503).json({
        error: 'BASE44 export webhook is not configured',
        requestId: req.ctx.requestId,
      });
      return;
    }

    const providedSecret = getSecretFromRequest(req);
    if (!providedSecret || providedSecret !== env.base44ExportWebhookSecret) {
      res.status(401).json({
        error: 'Invalid webhook secret',
        requestId: req.ctx.requestId,
      });
      return;
    }

    const customerId = String(req.body.customerId || '').trim();
    const tenantId =
      String(req.body.tenantId || req.ctx.tenantId || 'default').trim();
    const actorId = 'base44-webhook';
    const indexHtml = String(req.body.indexHtml || '').trim();

    if (!customerId) {
      res.status(400).json({
        error: 'customerId is required',
        requestId: req.ctx.requestId,
      });
      return;
    }

    if (!indexHtml) {
      res.status(400).json({
        error: 'indexHtml is required',
        requestId: req.ctx.requestId,
      });
      return;
    }

    const customer = await this.customersService.getCustomerById(
      tenantId,
      customerId,
    );

    if (!customer) {
      res.status(404).json({
        error: 'Customer not found',
        requestId: req.ctx.requestId,
      });
      return;
    }

    const syncResult = await this.contentSyncService.syncCustomerContent(customer, {
      customerId,
      tenantId,
      actorId,
      projectId: String(req.body.projectId || req.body.appId || customer.base44?.appId || '').trim(),
      indexHtml,
      additionalFiles: parseAdditionalFiles(req.body.additionalFiles),
    });

    const refreshed = await this.customersService.getCustomerById(
      tenantId,
      customerId,
    );

    res.status(200).json({
      data: {
        customer: refreshed,
        sync: syncResult,
      },
      requestId: req.ctx.requestId,
    });
  };
}