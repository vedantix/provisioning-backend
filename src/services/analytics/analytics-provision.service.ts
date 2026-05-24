import { AnalyticsIntegrationsRepository } from '../../repositories/analytics-integrations.repository';
import { AuditService } from '../../domain/audit/audit.service';
import { logger } from '../../lib/logger';
import { AppError, NotFoundError } from '../../errors/app-error';
import { GoogleAnalyticsService } from './google-analytics.service';
import { SearchConsoleService } from './search-console.service';
import { ClarityService } from './clarity.service';
import type {
  AnalyticsDashboardMetricDefinition,
  AnalyticsDeleteInput,
  AnalyticsIntegrationRecord,
  AnalyticsProvisionInput,
  AnalyticsProviderStatus,
  AnalyticsRepairInput,
  AnalyticsStatusResult,
  ClarityProvisionResult,
  GoogleAnalyticsDataStreamResult,
  GoogleAnalyticsPropertyResult,
  SearchConsoleProvisionResult,
} from './analytics.types';

const DASHBOARD_METRICS: AnalyticsDashboardMetricDefinition[] = [
  {
    key: 'visitors',
    provider: 'GOOGLE_ANALYTICS',
    description: 'Aantal bezoekers per periode',
  },
  {
    key: 'sessions',
    provider: 'GOOGLE_ANALYTICS',
    description: 'Sessies per periode',
  },
  {
    key: 'top_pages',
    provider: 'GOOGLE_ANALYTICS',
    description: 'Best bezochte pagina\'s',
  },
  {
    key: 'search_queries',
    provider: 'SEARCH_CONSOLE',
    description: 'Zoekwoorden en organisch verkeer',
  },
  {
    key: 'conversions',
    provider: 'VEDANTIX',
    description: 'Afspraken en offerteconversies',
  },
];

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

function defaultDisplayName(input: AnalyticsProvisionInput): string {
  return input.displayName?.trim() || normalizeDomain(input.domain);
}

function initialGoogle(status: AnalyticsProviderStatus = 'PENDING') {
  return { status };
}

function initialSearch(status: AnalyticsProviderStatus = 'PENDING') {
  return { status, verified: false };
}

function initialClarity(status: AnalyticsProviderStatus = 'PENDING') {
  return { status };
}

function buildTrackingEnvironment(input: {
  measurementId?: string;
  clarityProjectId?: string;
}): Record<string, string> {
  const envVars: Record<string, string> = {};

  if (input.measurementId) {
    envVars.VITE_GA_MEASUREMENT_ID = input.measurementId;
    envVars.NEXT_PUBLIC_GA_MEASUREMENT_ID = input.measurementId;
  }

  if (input.clarityProjectId) {
    envVars.VITE_CLARITY_PROJECT_ID = input.clarityProjectId;
    envVars.NEXT_PUBLIC_CLARITY_PROJECT_ID = input.clarityProjectId;
  }

  return envVars;
}

function toStatusResult(
  record: AnalyticsIntegrationRecord | null,
  customerId: string,
): AnalyticsStatusResult {
  return {
    customerId,
    deploymentId: record?.deploymentId,
    domain: record?.domain,
    googleAnalytics: record?.googleAnalytics ?? initialGoogle('PENDING'),
    searchConsole: record?.searchConsole ?? initialSearch('PENDING'),
    clarity: record?.clarity ?? initialClarity('PENDING'),
    trackingEnvironment: record?.trackingEnvironment ?? {},
    ready: Boolean(
      record?.googleAnalytics.measurementId &&
        record?.searchConsole.verified &&
        (record?.clarity.status === 'PROVISIONED' ||
          record?.clarity.status === 'SKIPPED'),
    ),
  };
}

export class AnalyticsProvisionService {
  constructor(
    private readonly repository = new AnalyticsIntegrationsRepository(),
    private readonly googleAnalyticsService = new GoogleAnalyticsService(),
    private readonly searchConsoleService = new SearchConsoleService(),
    private readonly clarityService = new ClarityService(),
    private readonly auditService = new AuditService(),
  ) {}

  async provisionAnalytics(
    input: AnalyticsProvisionInput,
  ): Promise<AnalyticsIntegrationRecord> {
    const afterGoogle = await this.provisionGoogleAnalytics(input);
    const afterSearch = await this.provisionSearchConsole(input);
    const afterClarity = await this.provisionClarity(input);

    return {
      ...afterGoogle,
      ...afterSearch,
      ...afterClarity,
      googleAnalytics: afterGoogle.googleAnalytics,
      searchConsole: afterSearch.searchConsole,
      clarity: afterClarity.clarity,
      trackingEnvironment: buildTrackingEnvironment({
        measurementId: afterGoogle.googleAnalytics.measurementId,
        clarityProjectId: afterClarity.clarity.projectId,
      }),
      updatedAt: nowIso(),
    };
  }

  async provisionGoogleAnalytics(
    input: AnalyticsProvisionInput,
  ): Promise<AnalyticsIntegrationRecord> {
    const record = await this.ensureRecord(input);
    const existingMeasurementId = record.googleAnalytics.measurementId;

    if (existingMeasurementId && record.googleAnalytics.status === 'PROVISIONED') {
      return record;
    }

    try {
      const result = await this.withRetry(
        () =>
          this.googleAnalyticsService.reconcileProperty({
            displayName: defaultDisplayName(input),
            domain: input.domain,
            propertyId: record.googleAnalytics.propertyId,
            customerId: input.customerId,
            deploymentId: input.deploymentId,
          }),
        'GOOGLE_ANALYTICS',
        input,
      );

      const updated = this.mergeGoogle(record, result);
      await this.persist(updated, 'GOOGLE_ANALYTICS', input);
      return updated;
    } catch (error) {
      const failed = this.withProviderFailure(record, 'GOOGLE_ANALYTICS', error);
      await this.persist(failed, 'GOOGLE_ANALYTICS', input);
      throw error;
    }
  }

  async provisionSearchConsole(
    input: AnalyticsProvisionInput,
  ): Promise<AnalyticsIntegrationRecord> {
    if (!input.hostedZoneId) {
      throw new AppError(
        'hostedZoneId is required for Search Console DNS verification',
        400,
        'SEARCH_CONSOLE_HOSTED_ZONE_REQUIRED',
      );
    }

    const record = await this.ensureRecord(input);

    if (record.searchConsole.verified && record.searchConsole.status === 'VERIFIED') {
      return record;
    }

    try {
      const result = await this.withRetry(
        () =>
          this.searchConsoleService.reconcileProperty({
            domain: input.domain,
            hostedZoneId: input.hostedZoneId!,
            customerId: input.customerId,
            deploymentId: input.deploymentId,
            existingToken: record.searchConsole.verificationToken,
          }),
        'SEARCH_CONSOLE',
        input,
      );

      const updated = this.mergeSearch(record, result);
      await this.persist(updated, 'SEARCH_CONSOLE', input);
      return updated;
    } catch (error) {
      const failed = this.withProviderFailure(record, 'SEARCH_CONSOLE', error);
      await this.persist(failed, 'SEARCH_CONSOLE', input);
      throw error;
    }
  }

  async provisionClarity(
    input: AnalyticsProvisionInput,
  ): Promise<AnalyticsIntegrationRecord> {
    const record = await this.ensureRecord(input);

    if (
      record.clarity.projectId &&
      record.clarity.status === 'PROVISIONED'
    ) {
      return record;
    }

    try {
      const result = await this.withRetry(
        () =>
          this.clarityService.reconcileProject({
            displayName: defaultDisplayName(input),
            domain: input.domain,
            existingProjectId: record.clarity.projectId,
            customerId: input.customerId,
            deploymentId: input.deploymentId,
          }),
        'CLARITY',
        input,
      );

      const updated = this.mergeClarity(record, result);
      await this.persist(updated, 'CLARITY', input);
      return updated;
    } catch (error) {
      const failed = this.withProviderFailure(record, 'CLARITY', error);
      await this.persist(failed, 'CLARITY', input);
      throw error;
    }
  }

  async repairAnalytics(input: AnalyticsRepairInput): Promise<AnalyticsIntegrationRecord> {
    return this.provisionAnalytics(input);
  }

  async reconcileAnalytics(input: AnalyticsProvisionInput): Promise<AnalyticsStatusResult> {
    const record = await this.provisionAnalytics(input);
    return toStatusResult(record, input.customerId);
  }

  async deleteAnalytics(input: AnalyticsDeleteInput): Promise<AnalyticsIntegrationRecord | null> {
    const record = await this.repository.getByCustomerId(input.customerId);

    if (!record) {
      return null;
    }

    if (record.tenantId !== input.tenantId) {
      throw new NotFoundError('Analytics integration not found');
    }

    const now = nowIso();

    if (record.googleAnalytics.propertyId) {
      await this.googleAnalyticsService
        .deleteProperty(record.googleAnalytics.propertyId)
        .catch((error) => {
          logger.exception('Google Analytics delete failed', error, {
            provider: 'GOOGLE_ANALYTICS',
            customerId: input.customerId,
            deploymentId: record.deploymentId,
            resourceId: record.googleAnalytics.propertyId,
          });
        });
    }

    if (record.searchConsole.propertyId) {
      await this.searchConsoleService
        .deleteProperty(record.searchConsole.propertyId)
        .catch((error) => {
          logger.exception('Search Console delete failed', error, {
            provider: 'SEARCH_CONSOLE',
            customerId: input.customerId,
            deploymentId: record.deploymentId,
            resourceId: record.searchConsole.propertyId,
          });
        });
    }

    if (record.clarity.projectId) {
      await this.clarityService.deleteProject(record.clarity.projectId);
    }

    const deleted: AnalyticsIntegrationRecord = {
      ...record,
      googleAnalytics: {
        ...record.googleAnalytics,
        status: 'DELETED',
        updatedAt: now,
      },
      searchConsole: {
        ...record.searchConsole,
        verified: false,
        status: 'DELETED',
        updatedAt: now,
      },
      clarity: {
        ...record.clarity,
        status: 'DELETED',
        updatedAt: now,
      },
      deletedAt: now,
      updatedAt: now,
    };

    await this.repository.upsert(deleted);
    await this.writeAudit(input, 'ANALYTICS_DELETE_COMPLETED', {
      deploymentId: record.deploymentId,
      domain: record.domain,
    });

    return deleted;
  }

  async getAnalytics(customerId: string, tenantId: string): Promise<AnalyticsIntegrationRecord> {
    const record = await this.repository.getByCustomerId(customerId);

    if (!record || record.tenantId !== tenantId) {
      throw new NotFoundError('Analytics integration not found');
    }

    return record;
  }

  async getStatus(customerId: string, tenantId: string): Promise<AnalyticsStatusResult> {
    const record = await this.repository.getByCustomerId(customerId);

    if (record && record.tenantId !== tenantId) {
      throw new NotFoundError('Analytics integration not found');
    }

    return toStatusResult(record, customerId);
  }

  private async ensureRecord(
    input: AnalyticsProvisionInput,
  ): Promise<AnalyticsIntegrationRecord> {
    const existing = await this.repository.getByCustomerId(input.customerId);
    const now = nowIso();

    if (existing) {
      if (existing.tenantId !== input.tenantId) {
        throw new NotFoundError('Analytics integration not found');
      }

      return {
        ...existing,
        deploymentId: input.deploymentId || existing.deploymentId,
        domain: input.domain || existing.domain,
        normalizedDomain: normalizeDomain(input.domain || existing.domain),
        updatedAt: now,
      };
    }

    const record: AnalyticsIntegrationRecord = {
      customerId: input.customerId,
      tenantId: input.tenantId,
      deploymentId: input.deploymentId,
      domain: input.domain,
      normalizedDomain: normalizeDomain(input.domain),
      googleAnalytics: initialGoogle(),
      searchConsole: initialSearch(),
      clarity: initialClarity(),
      trackingEnvironment: {},
      dashboardMetrics: DASHBOARD_METRICS,
      createdAt: now,
      updatedAt: now,
    };

    await this.repository.upsert(record);
    return record;
  }

  private mergeGoogle(
    record: AnalyticsIntegrationRecord,
    result: GoogleAnalyticsPropertyResult & GoogleAnalyticsDataStreamResult,
  ): AnalyticsIntegrationRecord {
    const now = nowIso();
    const updated: AnalyticsIntegrationRecord = {
      ...record,
      googleAnalytics: {
        propertyId: result.propertyId,
        propertyName: result.propertyName,
        dataStreamId: result.dataStreamId,
        dataStreamName: result.dataStreamName,
        measurementId: result.measurementId,
        status: 'PROVISIONED',
        updatedAt: now,
      },
      trackingEnvironment: buildTrackingEnvironment({
        measurementId: result.measurementId,
        clarityProjectId: record.clarity.projectId,
      }),
      updatedAt: now,
    };

    return updated;
  }

  private mergeSearch(
    record: AnalyticsIntegrationRecord,
    result: SearchConsoleProvisionResult,
  ): AnalyticsIntegrationRecord {
    const now = nowIso();

    return {
      ...record,
      searchConsole: {
        propertyId: result.propertyId,
        verificationToken: result.verificationToken,
        verificationRecordName: result.verificationRecordName,
        verificationRecordType: 'TXT',
        verified: result.verified,
        status: result.verified ? 'VERIFIED' : 'PROVISIONED',
        updatedAt: now,
      },
      updatedAt: now,
    };
  }

  private mergeClarity(
    record: AnalyticsIntegrationRecord,
    result: ClarityProvisionResult,
  ): AnalyticsIntegrationRecord {
    const now = nowIso();
    const clarity =
      result.skipped || !result.projectId
        ? {
            ...record.clarity,
            status: 'SKIPPED' as const,
            errorMessage: result.reason,
            updatedAt: now,
          }
        : {
            projectId: result.projectId,
            trackingCode:
              result.trackingCode ||
              this.clarityService.getTrackingCode(result.projectId),
            status: 'PROVISIONED' as const,
            updatedAt: now,
          };

    return {
      ...record,
      clarity,
      trackingEnvironment: buildTrackingEnvironment({
        measurementId: record.googleAnalytics.measurementId,
        clarityProjectId: clarity.projectId,
      }),
      updatedAt: now,
    };
  }

  private withProviderFailure(
    record: AnalyticsIntegrationRecord,
    provider: 'GOOGLE_ANALYTICS' | 'SEARCH_CONSOLE' | 'CLARITY',
    error: unknown,
  ): AnalyticsIntegrationRecord {
    const now = nowIso();
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (provider === 'GOOGLE_ANALYTICS') {
      return {
        ...record,
        googleAnalytics: {
          ...record.googleAnalytics,
          status: 'FAILED',
          errorMessage,
          updatedAt: now,
        },
        updatedAt: now,
      };
    }

    if (provider === 'SEARCH_CONSOLE') {
      return {
        ...record,
        searchConsole: {
          ...record.searchConsole,
          status: 'FAILED',
          errorMessage,
          updatedAt: now,
        },
        updatedAt: now,
      };
    }

    return {
      ...record,
      clarity: {
        ...record.clarity,
        status: 'FAILED',
        errorMessage,
        updatedAt: now,
      },
      updatedAt: now,
    };
  }

  private async persist(
    record: AnalyticsIntegrationRecord,
    provider: string,
    input: AnalyticsProvisionInput,
  ): Promise<void> {
    await this.repository.upsert(record);

    logger.info('Analytics provider state persisted', {
      customerId: input.customerId,
      deploymentId: input.deploymentId,
      domain: normalizeDomain(input.domain),
      provider,
      status:
        provider === 'GOOGLE_ANALYTICS'
          ? record.googleAnalytics.status
          : provider === 'SEARCH_CONSOLE'
            ? record.searchConsole.status
            : record.clarity.status,
    });
  }

  private async withRetry<T>(
    fn: () => Promise<T>,
    provider: string,
    input: AnalyticsProvisionInput,
    maxAttempts = 3,
  ): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        logger.exception('Analytics provider attempt failed', error, {
          customerId: input.customerId,
          deploymentId: input.deploymentId,
          domain: normalizeDomain(input.domain),
          provider,
          attempt,
          maxAttempts,
        });

        if (attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
        }
      }
    }

    throw lastError;
  }

  private async writeAudit(
    input: { tenantId: string; customerId?: string; actorId?: string },
    eventType: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.auditService
      .write({
        tenantId: input.tenantId,
        customerId: input.customerId,
        actorId: input.actorId,
        eventType: eventType as any,
        metadata,
      })
      .catch((error) => {
        logger.exception('Analytics audit write failed', error, {
          customerId: input.customerId,
          eventType,
        });
      });
  }
}
