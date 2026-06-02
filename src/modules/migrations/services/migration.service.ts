import crypto from 'node:crypto';
import { AppError, BadRequestError, NotFoundError } from '../../../errors/app-error';
import { CustomersService } from '../../customers/services/customers.service';
import { migrationChildSk, migrationPk, migrationSk, MigrationRepository } from '../repositories/migration.repository';
import type {
  MigrationImageRecord,
  MigrationPageRecord,
  MigrationRecord,
  MigrationReportData,
  MigrationReportRecord,
  StartMigrationInput,
} from '../types/migration.types';
import { ComparisonService } from './comparison.service';
import { MigrationAiService } from './migration-ai.service';
import { MigrationReportService } from './report.service';
import { WebsiteCrawlerService } from './website-crawler.service';

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeUrl(input: string, fieldName: string): string {
  const trimmed = String(input || '').trim();
  if (!trimmed) {
    throw new BadRequestError(`${fieldName} is verplicht.`);
  }
  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error('Unsupported protocol');
    }
    url.hash = '';
    return url.toString();
  } catch {
    throw new BadRequestError(`${fieldName} is geen geldige URL.`);
  }
}

function stableId(value: string): string {
  return crypto.createHash('sha1').update(value).digest('hex').slice(0, 16);
}

export class MigrationService {
  constructor(
    private readonly repository = new MigrationRepository(),
    private readonly crawler = new WebsiteCrawlerService(),
    private readonly comparison = new ComparisonService(),
    private readonly ai = new MigrationAiService(),
    private readonly reportService = new MigrationReportService(),
    private readonly customersService = new CustomersService(),
  ) {}

  async list(tenantId: string): Promise<MigrationRecord[]> {
    return this.repository.listMigrations(tenantId);
  }

  async getDetail(
    tenantId: string,
    migrationId: string,
  ): Promise<{
    migration: MigrationRecord;
    pages: MigrationPageRecord[];
    report: MigrationReportData | null;
  }> {
    const migration = await this.getRequiredMigration(tenantId, migrationId);
    const pages = await this.repository.listPages(tenantId, migrationId);
    const report = migration.reportId
      ? await this.repository.getReport(tenantId, migrationId, migration.reportId)
      : null;

    return {
      migration,
      pages,
      report: report?.reportData || null,
    };
  }

  async start(input: StartMigrationInput): Promise<{
    migration: MigrationRecord;
    pages: MigrationPageRecord[];
    report: MigrationReportData | null;
  }> {
    const sourceUrl = normalizeUrl(input.sourceUrl, 'Old Website URL');
    const targetUrl = input.targetUrl
      ? normalizeUrl(input.targetUrl, 'Target Website')
      : undefined;
    const customer = await this.customersService.getCustomerById(
      input.tenantId,
      input.customerId,
    );

    if (!customer) {
      throw new NotFoundError('Klant niet gevonden.');
    }

    const migrationId = crypto.randomUUID();
    const now = nowIso();
    const migration: MigrationRecord = {
      pk: migrationPk(input.tenantId),
      sk: migrationSk(migrationId),
      entityType: 'MIGRATION',
      tenantId: input.tenantId,
      migrationId,
      customerId: customer.id,
      customerName: input.customerName || customer.companyName,
      sourceUrl,
      targetUrl: targetUrl || `https://${customer.domain}`,
      industry: input.industry?.trim() || customer.base44?.niche,
      status: 'QUEUED',
      progress: 0,
      counts: {
        pages: 0,
        images: 0,
        faqs: 0,
        testimonials: 0,
        ctas: 0,
      },
      seoScore: 0,
      coverageScore: 0,
      aiStatus: 'NOT_STARTED',
      importStatus: 'NOT_STARTED',
      startedAt: now,
      createdAt: now,
      updatedAt: now,
      createdBy: input.actorId,
      updatedBy: input.actorId,
    };

    await this.repository.putMigration(migration);
    await this.analyze(input.tenantId, migrationId, input.actorId);
    return this.getDetail(input.tenantId, migrationId);
  }

  async analyze(
    tenantId: string,
    migrationId: string,
    actorId: string,
  ): Promise<MigrationRecord> {
    const migration = await this.getRequiredMigration(tenantId, migrationId);
    const running = await this.updateMigration(migration, {
      status: 'RUNNING',
      progress: 15,
      lastError: undefined,
      updatedBy: actorId,
    });

    try {
      const crawl = await this.crawler.crawl({
        tenantId,
        migrationId,
        actorId,
        sourceUrl: running.sourceUrl,
      });

      const imageRecords = crawl.images.map((image): MigrationImageRecord => {
        const imageId = stableId(`${image.imageUrl}::${image.sourcePageUrl || ''}`);
        const now = nowIso();
        return {
          pk: migrationPk(tenantId),
          sk: migrationChildSk(migrationId, 'IMAGE', imageId),
          entityType: 'IMAGE',
          tenantId,
          migrationId,
          imageId,
          imageUrl: image.imageUrl,
          altText: image.altText,
          sourcePageUrl: image.sourcePageUrl,
          createdAt: now,
          updatedAt: now,
          createdBy: actorId,
          updatedBy: actorId,
        };
      });

      await this.repository.replaceAnalysis({
        tenantId,
        migrationId,
        pages: crawl.pages,
        images: imageRecords,
      });

      const summary = this.comparison.summarizeMigration(running, crawl.pages);
      const analyzed = await this.updateMigration(running, {
        ...summary,
        status: 'ANALYZED',
        progress: 70,
        updatedBy: actorId,
      });

      await this.createAndAttachReport(analyzed, crawl.pages, actorId);
      return this.getRequiredMigration(tenantId, migrationId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Analyse mislukt';
      await this.updateMigration(running, {
        status: 'FAILED',
        progress: 0,
        lastError: message,
        updatedBy: actorId,
      });
      throw error;
    }
  }

  async improveWithAi(
    tenantId: string,
    migrationId: string,
    actorId: string,
  ): Promise<{
    migration: MigrationRecord;
    pages: MigrationPageRecord[];
    report: MigrationReportData | null;
  }> {
    const migration = await this.getRequiredMigration(tenantId, migrationId);
    const pages = await this.repository.listPages(tenantId, migrationId);
    if (pages.length === 0) {
      throw new BadRequestError('Analyseer de website eerst voordat AI verbetering wordt gestart.');
    }

    const running = await this.updateMigration(migration, {
      status: 'IMPROVING',
      aiStatus: this.ai.isConfigured() ? 'RUNNING' : 'NOT_CONFIGURED',
      progress: 82,
      updatedBy: actorId,
    });

    try {
      const improvedPages = await this.ai.improvePages({
        pages,
        industry: migration.industry,
      });
      await this.repository.putPages(
        improvedPages.map((page) => ({
          ...page,
          updatedAt: nowIso(),
          updatedBy: actorId,
        })),
      );

      const updated = await this.updateMigration(running, {
        status: 'READY_FOR_IMPORT',
        aiStatus: this.ai.isConfigured() ? 'SUCCEEDED' : 'NOT_CONFIGURED',
        progress: 92,
        updatedBy: actorId,
      });

      await this.createAndAttachReport(updated, improvedPages, actorId);
      return this.getDetail(tenantId, migrationId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'AI verbetering mislukt';
      await this.updateMigration(running, {
        status: 'FAILED',
        aiStatus: 'FAILED',
        lastError: message,
        updatedBy: actorId,
      });
      throw error;
    }
  }

  async buildImportPayload(
    tenantId: string,
    migrationId: string,
    actorId: string,
  ): Promise<MigrationRecord> {
    const migration = await this.getRequiredMigration(tenantId, migrationId);
    const pages = await this.repository.listPages(tenantId, migrationId);
    if (pages.length === 0) {
      throw new BadRequestError('Er zijn nog geen pagina’s gevonden om te importeren.');
    }

    const importPayload = this.comparison.buildImportPayload(migration, pages);
    return this.updateMigration(migration, {
      status: 'IMPORTED',
      progress: 100,
      importStatus: 'IMPORTED',
      importPayload,
      completedAt: nowIso(),
      updatedBy: actorId,
    });
  }

  async getReportData(
    tenantId: string,
    migrationId: string,
  ): Promise<MigrationReportData> {
    const detail = await this.getDetail(tenantId, migrationId);
    if (detail.report) return detail.report;

    const report = await this.createAndAttachReport(
      detail.migration,
      detail.pages,
      detail.migration.updatedBy || 'system',
    );
    return report.reportData;
  }

  async exportReport(
    tenantId: string,
    migrationId: string,
    format: 'json' | 'pdf' | 'xlsx',
  ): Promise<{
    buffer: Buffer;
    contentType: string;
    filename: string;
  }> {
    const report = await this.getReportData(tenantId, migrationId);
    const baseName = `migration-report-${migrationId}`;

    if (format === 'pdf') {
      return {
        buffer: await this.reportService.toPdf(report),
        contentType: 'application/pdf',
        filename: `${baseName}.pdf`,
      };
    }

    if (format === 'xlsx') {
      return {
        buffer: await this.reportService.toExcel(report),
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        filename: `${baseName}.xlsx`,
      };
    }

    return {
      buffer: Buffer.from(JSON.stringify(report, null, 2), 'utf-8'),
      contentType: 'application/json',
      filename: `${baseName}.json`,
    };
  }

  private async getRequiredMigration(
    tenantId: string,
    migrationId: string,
  ): Promise<MigrationRecord> {
    const migration = await this.repository.getMigration(tenantId, migrationId);
    if (!migration) {
      throw new NotFoundError('Migratie niet gevonden.');
    }
    return migration;
  }

  private async updateMigration(
    migration: MigrationRecord,
    patch: Partial<MigrationRecord>,
  ): Promise<MigrationRecord> {
    const updated: MigrationRecord = {
      ...migration,
      ...patch,
      pk: migration.pk,
      sk: migration.sk,
      entityType: 'MIGRATION',
      tenantId: migration.tenantId,
      migrationId: migration.migrationId,
      customerId: migration.customerId,
      updatedAt: nowIso(),
    };
    return this.repository.putMigration(updated);
  }

  private async createAndAttachReport(
    migration: MigrationRecord,
    pages: MigrationPageRecord[],
    actorId: string,
  ): Promise<MigrationReportRecord> {
    if (pages.length === 0) {
      throw new AppError('Geen pagina’s beschikbaar voor rapportage.', 400, 'NO_MIGRATION_PAGES');
    }

    const reportId = migration.reportId || crypto.randomUUID();
    const now = nowIso();
    const reportData = this.comparison.buildReportData(migration, pages);
    const report: MigrationReportRecord = {
      pk: migrationPk(migration.tenantId),
      sk: migrationChildSk(migration.migrationId, 'REPORT', reportId),
      entityType: 'REPORT',
      tenantId: migration.tenantId,
      migrationId: migration.migrationId,
      reportId,
      reportData,
      createdAt: now,
      updatedAt: now,
      createdBy: actorId,
      updatedBy: actorId,
    };

    const saved = await this.repository.putReport(report);
    if (!migration.reportId) {
      await this.updateMigration(migration, {
        reportId,
        updatedBy: actorId,
      });
    }
    return saved;
  }
}
