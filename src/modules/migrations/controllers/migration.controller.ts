import type { Request, Response } from 'express';
import { BadRequestError } from '../../../errors/app-error';
import { MigrationService } from '../services/migration.service';

function readMigrationId(req: Request): string {
  const migrationId = String(req.params.migrationId || '').trim();
  if (!migrationId) throw new BadRequestError('migrationId is verplicht.');
  return migrationId;
}

function readFormat(req: Request): 'json' | 'pdf' | 'xlsx' {
  const format = String(req.params.format || req.query.format || 'json')
    .replace(/^\./, '')
    .toLowerCase();
  if (format === 'pdf' || format === 'xlsx' || format === 'json') return format;
  throw new BadRequestError('Ongeldig rapport formaat.');
}

export class MigrationController {
  constructor(private readonly service = new MigrationService()) {}

  list = async (req: Request, res: Response): Promise<void> => {
    const migrations = await this.service.list(req.ctx.tenantId);
    res.status(200).json({
      data: migrations,
      requestId: req.ctx.requestId,
    });
  };

  start = async (req: Request, res: Response): Promise<void> => {
    const result = await this.service.start({
      tenantId: req.ctx.tenantId,
      actorId: req.ctx.actorId,
      customerId: req.body?.customerId,
      customerName: req.body?.customerName,
      sourceUrl: req.body?.sourceUrl,
      targetUrl: req.body?.targetUrl,
      industry: req.body?.industry,
    });

    res.status(201).json({
      data: result,
      requestId: req.ctx.requestId,
    });
  };

  detail = async (req: Request, res: Response): Promise<void> => {
    const result = await this.service.getDetail(req.ctx.tenantId, readMigrationId(req));
    res.status(200).json({
      data: result,
      requestId: req.ctx.requestId,
    });
  };

  analyze = async (req: Request, res: Response): Promise<void> => {
    const migration = await this.service.analyze(
      req.ctx.tenantId,
      readMigrationId(req),
      req.ctx.actorId,
    );

    res.status(200).json({
      data: migration,
      requestId: req.ctx.requestId,
    });
  };

  improve = async (req: Request, res: Response): Promise<void> => {
    const result = await this.service.improveWithAi(
      req.ctx.tenantId,
      readMigrationId(req),
      req.ctx.actorId,
    );

    res.status(200).json({
      data: result,
      requestId: req.ctx.requestId,
    });
  };

  importPayload = async (req: Request, res: Response): Promise<void> => {
    const migration = await this.service.buildImportPayload(
      req.ctx.tenantId,
      readMigrationId(req),
      req.ctx.actorId,
    );

    res.status(200).json({
      data: migration,
      requestId: req.ctx.requestId,
    });
  };

  report = async (req: Request, res: Response): Promise<void> => {
    const report = await this.service.getReportData(req.ctx.tenantId, readMigrationId(req));
    res.status(200).json({
      data: report,
      requestId: req.ctx.requestId,
    });
  };

  downloadReport = async (req: Request, res: Response): Promise<void> => {
    const result = await this.service.exportReport(
      req.ctx.tenantId,
      readMigrationId(req),
      readFormat(req),
    );

    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.status(200).send(result.buffer);
  };
}
