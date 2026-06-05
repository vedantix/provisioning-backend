import type { Request, Response } from 'express';
import { BadRequestError } from '../../../errors/app-error';
import type { AuditStatus } from '../types/online-growth-audit.types';
import { OnlineGrowthAuditService } from '../services/online-growth-audit.service';

function readAuditId(req: Request): string {
  const auditId = String(req.params.id || '').trim();
  if (!auditId) throw new BadRequestError('auditId is verplicht.');
  return auditId;
}

function readStatus(value: unknown): AuditStatus | undefined {
  const status = String(value || '').trim().toUpperCase();
  if (!status) return undefined;
  if (['PENDING', 'RUNNING', 'COMPLETED', 'FAILED'].includes(status)) {
    return status as AuditStatus;
  }
  throw new BadRequestError('Ongeldige auditstatus.');
}

export class OnlineGrowthAuditController {
  constructor(private readonly service = new OnlineGrowthAuditService()) {}

  start = async (req: Request, res: Response): Promise<void> => {
    const result = await this.service.startAudit({
      tenantId: req.ctx.tenantId,
      name: req.body?.name,
      companyName: req.body?.companyName,
      email: req.body?.email,
      websiteUrl: req.body?.websiteUrl,
      competitorUrl1: req.body?.competitorUrl1,
      competitorUrl2: req.body?.competitorUrl2,
    });

    res.status(202).json({
      data: result,
      requestId: req.ctx.requestId,
    });
  };

  detail = async (req: Request, res: Response): Promise<void> => {
    const { request, results } = await this.service.getAudit(
      req.ctx.tenantId,
      readAuditId(req),
    );

    res.status(200).json({
      data: {
        auditId: request.id,
        status: request.status,
        request,
        ...(results ? { results } : {}),
      },
      requestId: req.ctx.requestId,
    });
  };

  downloadPdf = async (req: Request, res: Response): Promise<void> => {
    const result = await this.service.generatePdf(
      req.ctx.tenantId,
      readAuditId(req),
    );

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.status(200).send(result.buffer);
  };

  history = async (req: Request, res: Response): Promise<void> => {
    const audits = await this.service.listAudits(
      req.ctx.tenantId,
      readStatus(req.query.status),
    );

    res.status(200).json({
      data: audits,
      requestId: req.ctx.requestId,
    });
  };
}
