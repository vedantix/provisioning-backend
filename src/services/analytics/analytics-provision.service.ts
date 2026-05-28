import { AnalyticsIntegrationsRepository } from '../../repositories/analytics-integrations.repository';
import { DeadLetterRepository } from '../../repositories/dead-letter.repository';
import { AuditService } from '../../domain/audit/audit.service';
import { logger } from '../../lib/logger';
import { AppError, NotFoundError } from '../../errors/app-error';
import { env } from '../../config/env';
import {
  DistributedLockConflictError,
  DistributedLockService,
} from '../../domain/locks/distributed-lock.service';
import { GoogleAnalyticsService } from './google-analytics.service';
import { SearchConsoleService } from './search-console.service';
import { GoogleAdsService } from './google-ads.service';
import { ClarityService } from './clarity.service';
import { EnvironmentValidationService } from './environment-validation.service';
import type {
  AnalyticsDashboardMetricDefinition,
  AnalyticsDeleteInput,
  AnalyticsIntegrationRecord,
  AnalyticsProvisionInput,
  AnalyticsProvisioningError,
  AnalyticsProviderStatus,
  AnalyticsRetryMetadata,
  AnalyticsRepairInput,
  AnalyticsStatusResult,
  ClarityProvisionResult,
  GoogleAdsProvisionResult,
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

type AnalyticsProvider = 'GOOGLE_ANALYTICS' | 'SEARCH_CONSOLE' | 'GOOGLE_ADS' | 'CLARITY';

function nowIso(): string {
  return new Date().toISOString();
}

function createOperationId(prefix: string, input: AnalyticsProvisionInput): string {
  return [
    prefix,
    input.customerId,
    input.deploymentId,
    input.idempotencyKey,
    input.requestId,
  ]
    .filter(Boolean)
    .join(':');
}

function addMs(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

function defaultDisplayName(input: AnalyticsProvisionInput): string {
  return input.displayName?.trim() || normalizeDomain(input.domain);
}

function initialGoogle(status: AnalyticsProviderStatus = 'NOT_STARTED') {
  return { status };
}

function initialSearch(status: AnalyticsProviderStatus = 'NOT_STARTED') {
  return { status, verified: false };
}

function initialGoogleAds(status: AnalyticsProviderStatus = 'NOT_STARTED') {
  return {
    status,
    enhancedConversionsEnabled: true,
    conversions: [],
  };
}

function initialClarity(status: AnalyticsProviderStatus = 'NOT_STARTED') {
  return { status };
}

function buildTrackingEnvironment(input: {
  measurementId?: string;
  searchConsoleVerificationToken?: string;
  googleAds?: GoogleAdsProvisionResult;
  clarityProjectId?: string;
}): Record<string, string> {
  const envVars: Record<string, string> = {};

  if (input.measurementId) {
    envVars.VITE_GA_MEASUREMENT_ID = input.measurementId;
    envVars.NEXT_PUBLIC_GA_MEASUREMENT_ID = input.measurementId;
  }

  if (input.searchConsoleVerificationToken) {
    const verification = input.searchConsoleVerificationToken
      .replace(/^google-site-verification=/i, '')
      .replace(/^"|"$/g, '')
      .trim();

    if (verification) {
      envVars.VITE_GOOGLE_SITE_VERIFICATION = verification;
      envVars.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION = verification;
    }
  }

  if (input.googleAds) {
    const googleAdsEnv = new GoogleAdsService().buildTrackingEnvironment(input.googleAds);
    Object.assign(envVars, googleAdsEnv);
  }

  if (input.clarityProjectId) {
    envVars.VITE_CLARITY_PROJECT_ID = input.clarityProjectId;
    envVars.NEXT_PUBLIC_CLARITY_PROJECT_ID = input.clarityProjectId;
  }

  return envVars;
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof AppError) {
    if (
      error.code === 'GOOGLE_OAUTH_RECONNECT_REQUIRED' ||
      error.code.endsWith('_CONFIG') ||
      error.code.includes('CONFIG')
    ) {
      return false;
    }

    return (
      error.statusCode === 408 ||
      error.statusCode === 409 ||
      error.statusCode === 425 ||
      error.statusCode === 429 ||
      error.statusCode >= 500 ||
      error.code.endsWith('_TIMEOUT')
    );
  }

  const message = error instanceof Error ? error.message : String(error);
  return /timeout|timed out|rate limit|temporar|ECONNRESET|ETIMEDOUT|ENOTFOUND/i.test(message);
}

function retryDelayMs(attempt: number): number {
  const exponential = env.analyticsRetryBaseDelayMs * 2 ** Math.max(0, attempt - 1);
  const capped = Math.min(exponential, env.analyticsRetryMaxDelayMs);
  const jitter = env.analyticsRetryJitterMs > 0
    ? Math.floor(Math.random() * env.analyticsRetryJitterMs)
    : 0;
  return capped + jitter;
}

function toStatusResult(
  record: AnalyticsIntegrationRecord | null,
  customerId: string,
): AnalyticsStatusResult {
  return {
    customerId,
    deploymentId: record?.deploymentId,
    domain: record?.domain,
    googleAnalytics: record?.googleAnalytics ?? initialGoogle(),
    searchConsole: record?.searchConsole ?? initialSearch(),
    googleAds: record?.googleAds ?? initialGoogleAds(),
    clarity: record?.clarity ?? initialClarity(),
    provisioningStatus: record?.provisioningStatus ?? 'NOT_STARTED',
    provisioningErrors: record?.provisioningErrors ?? [],
    retryMetadata: record?.retryMetadata ?? {},
    timeline: record?.timeline ?? [],
    trackingEnvironment: record?.trackingEnvironment ?? {},
    ready: Boolean(
      record?.googleAnalytics.measurementId &&
        record?.searchConsole.verified &&
        record?.googleAds.status === 'SUCCEEDED' &&
        (record?.clarity.status === 'SUCCEEDED' ||
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
    private readonly googleAdsService = new GoogleAdsService(),
    private readonly environmentValidationService = new EnvironmentValidationService(),
    private readonly lockService = new DistributedLockService(),
    private readonly deadLetterRepository = new DeadLetterRepository(),
  ) {}

  async provisionAnalytics(
    input: AnalyticsProvisionInput,
  ): Promise<AnalyticsIntegrationRecord> {
    if (!input.skipAnalyticsLock) {
      return this.withAnalyticsLock(input, 'analytics-provision', (lockedInput) =>
        this.provisionAnalytics({ ...lockedInput, skipAnalyticsLock: true }),
      );
    }

    this.environmentValidationService.assertMarketingStackConfigured();
    await this.writeAudit(input, 'ANALYTICS_PROVISION_REQUESTED', {
      deploymentId: input.deploymentId,
      domain: normalizeDomain(input.domain),
      correlationId: input.requestId,
    });

    const afterGoogle = await this.provisionGoogleAnalytics(input);
    const afterSearch = await this.provisionSearchConsole(input);
    const afterGoogleAds = await this.provisionGoogleAds(input);
    const afterClarity = await this.provisionClarity(input);

    const completed: AnalyticsIntegrationRecord = {
      ...afterGoogle,
      ...afterSearch,
      ...afterGoogleAds,
      ...afterClarity,
      googleAnalytics: afterGoogle.googleAnalytics,
      searchConsole: afterSearch.searchConsole,
      googleAds: afterGoogleAds.googleAds,
      clarity: afterClarity.clarity,
      trackingEnvironment: buildTrackingEnvironment({
        measurementId: afterGoogle.googleAnalytics.measurementId,
        searchConsoleVerificationToken: afterSearch.searchConsole.verificationToken,
        googleAds: afterGoogleAds.googleAds.customerId
          ? {
              customerId: afterGoogleAds.googleAds.customerId,
              conversionId: afterGoogleAds.googleAds.conversionId,
              conversions: afterGoogleAds.googleAds.conversions,
            }
          : undefined,
        clarityProjectId: afterClarity.clarity.projectId,
      }),
      provisioningStatus: 'SUCCEEDED',
      updatedAt: nowIso(),
    };

    await this.repository.upsert(completed);
    await this.writeAudit(input, 'ANALYTICS_PROVISION_SUCCEEDED', {
      deploymentId: input.deploymentId,
      domain: normalizeDomain(input.domain),
      providers: ['GOOGLE_ANALYTICS', 'SEARCH_CONSOLE', 'GOOGLE_ADS', 'CLARITY'],
    });
    return completed;
  }

  async provisionGoogleAnalytics(
    input: AnalyticsProvisionInput,
  ): Promise<AnalyticsIntegrationRecord> {
    if (!input.skipAnalyticsLock) {
      return this.withAnalyticsLock(input, 'google-analytics', (lockedInput) =>
        this.provisionGoogleAnalytics({ ...lockedInput, skipAnalyticsLock: true }),
      );
    }

    this.environmentValidationService.assertMarketingStackConfigured();
    const record = await this.ensureRecord(input);
    const existingMeasurementId = record.googleAnalytics.measurementId;

    if (existingMeasurementId && record.googleAnalytics.status === 'SUCCEEDED') {
      return record;
    }

    const running = this.withProviderStatus(record, 'GOOGLE_ANALYTICS', 'RUNNING');
    await this.persist(running, 'GOOGLE_ANALYTICS', input);

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

      const updated = this.mergeGoogle(running, result);
      await this.persist(updated, 'GOOGLE_ANALYTICS', input);
      return updated;
    } catch (error) {
      const failed = this.withProviderFailure(running, 'GOOGLE_ANALYTICS', error);
      await this.persist(failed, 'GOOGLE_ANALYTICS', input);
      throw error;
    }
  }

  async provisionSearchConsole(
    input: AnalyticsProvisionInput,
  ): Promise<AnalyticsIntegrationRecord> {
    if (!input.skipAnalyticsLock) {
      return this.withAnalyticsLock(input, 'search-console', (lockedInput) =>
        this.provisionSearchConsole({ ...lockedInput, skipAnalyticsLock: true }),
      );
    }

    this.environmentValidationService.assertMarketingStackConfigured();
    if (!input.hostedZoneId) {
      throw new AppError(
        'hostedZoneId is required for Search Console DNS verification',
        400,
        'SEARCH_CONSOLE_HOSTED_ZONE_REQUIRED',
      );
    }

    const record = await this.ensureRecord(input);

    if (record.searchConsole.verified && record.searchConsole.status === 'SUCCEEDED') {
      return record;
    }

    const running = this.withProviderStatus(record, 'SEARCH_CONSOLE', 'RUNNING');
    await this.persist(running, 'SEARCH_CONSOLE', input);

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

      const updated = this.mergeSearch(running, result);
      await this.persist(updated, 'SEARCH_CONSOLE', input);
      return updated;
    } catch (error) {
      const failed = this.withProviderFailure(running, 'SEARCH_CONSOLE', error);
      await this.persist(failed, 'SEARCH_CONSOLE', input);
      throw error;
    }
  }

  async provisionGoogleAds(
    input: AnalyticsProvisionInput,
  ): Promise<AnalyticsIntegrationRecord> {
    if (!input.skipAnalyticsLock) {
      return this.withAnalyticsLock(input, 'google-ads', (lockedInput) =>
        this.provisionGoogleAds({ ...lockedInput, skipAnalyticsLock: true }),
      );
    }

    this.environmentValidationService.assertMarketingStackConfigured();
    const record = await this.ensureRecord(input);

    if (record.googleAds.status === 'SUCCEEDED' && record.googleAds.conversions.length > 0) {
      return record;
    }

    const running = this.withProviderStatus(record, 'GOOGLE_ADS', 'RUNNING');
    await this.persist(running, 'GOOGLE_ADS', input);

    try {
      const result = await this.withRetry(
        () =>
          this.googleAdsService.reconcileConversions({
            displayName: defaultDisplayName(input),
            domain: input.domain,
            existingConversions: running.googleAds.conversions,
            customerId: input.customerId,
            deploymentId: input.deploymentId,
          }),
        'GOOGLE_ADS',
        input,
      );

      const updated = this.mergeGoogleAds(running, result);
      await this.persist(updated, 'GOOGLE_ADS', input);
      return updated;
    } catch (error) {
      const failed = this.withProviderFailure(running, 'GOOGLE_ADS', error);
      await this.persist(failed, 'GOOGLE_ADS', input);
      throw error;
    }
  }

  async provisionClarity(
    input: AnalyticsProvisionInput,
  ): Promise<AnalyticsIntegrationRecord> {
    if (!input.skipAnalyticsLock) {
      return this.withAnalyticsLock(input, 'clarity', (lockedInput) =>
        this.provisionClarity({ ...lockedInput, skipAnalyticsLock: true }),
      );
    }

    const record = await this.ensureRecord(input);

    if (
      record.clarity.projectId &&
      record.clarity.status === 'SUCCEEDED'
    ) {
      return record;
    }

    const running = this.withProviderStatus(record, 'CLARITY', 'RUNNING');
    await this.persist(running, 'CLARITY', input);

    try {
      const result = await this.withRetry(
        () =>
          this.clarityService.reconcileProject({
            displayName: defaultDisplayName(input),
            domain: input.domain,
            existingProjectId: running.clarity.projectId,
            customerId: input.customerId,
            deploymentId: input.deploymentId,
          }),
        'CLARITY',
        input,
      );

      const updated = this.mergeClarity(running, result);
      await this.persist(updated, 'CLARITY', input);
      return updated;
    } catch (error) {
      const failed = this.withProviderFailure(running, 'CLARITY', error);
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

  async provisionTrackingInjection(
    input: AnalyticsProvisionInput,
  ): Promise<AnalyticsIntegrationRecord> {
    if (!input.skipAnalyticsLock) {
      return this.withAnalyticsLock(input, 'tracking-injection', (lockedInput) =>
        this.provisionTrackingInjection({ ...lockedInput, skipAnalyticsLock: true }),
      );
    }

    const record = await this.ensureRecord(input);
    const trackingEnvironment = buildTrackingEnvironment({
      measurementId: record.googleAnalytics.measurementId,
      searchConsoleVerificationToken: record.searchConsole.verificationToken,
      googleAds: record.googleAds.customerId
        ? {
            customerId: record.googleAds.customerId,
            conversionId: record.googleAds.conversionId,
            conversions: record.googleAds.conversions,
          }
        : undefined,
      clarityProjectId: record.clarity.projectId,
    });

    if (!trackingEnvironment.VITE_GA_MEASUREMENT_ID) {
      throw new AppError(
        'Tracking injection requires a Google Analytics Measurement ID',
        409,
        'TRACKING_ENVIRONMENT_INCOMPLETE',
      );
    }

    const now = nowIso();
    const stackSucceeded =
      record.googleAnalytics.status === 'SUCCEEDED' &&
      record.searchConsole.status === 'SUCCEEDED' &&
      record.googleAds.status === 'SUCCEEDED' &&
      (record.clarity.status === 'SUCCEEDED' || record.clarity.status === 'SKIPPED');
    const updated: AnalyticsIntegrationRecord = {
      ...record,
      trackingEnvironment,
      provisioningStatus:
        stackSucceeded
          ? 'SUCCEEDED'
          : record.provisioningStatus === 'FAILED'
            ? 'RETRYING'
            : record.provisioningStatus,
      timeline: this.appendTimeline(
        record,
        'TRACKING_INJECTION',
        'SUCCEEDED',
        'Tracking environment generated',
      ),
      updatedAt: now,
    };

    await this.repository.upsert(updated);
    return updated;
  }

  async deleteAnalytics(input: AnalyticsDeleteInput): Promise<AnalyticsIntegrationRecord | null> {
    const lockInput: AnalyticsProvisionInput = {
      tenantId: input.tenantId,
      customerId: input.customerId,
      deploymentId: input.deploymentId || `analytics-${input.customerId}`,
      domain: input.customerId,
      actorId: input.actorId,
    };

    return this.withAnalyticsLock(lockInput, 'analytics-delete', async () =>
      this.deleteAnalyticsUnlocked(input),
    );
  }

  private async deleteAnalyticsUnlocked(
    input: AnalyticsDeleteInput,
  ): Promise<AnalyticsIntegrationRecord | null> {
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
      googleAds: {
        ...record.googleAds,
        conversions: (record.googleAds?.conversions ?? []).map((conversion) => ({
          ...conversion,
          status: 'DELETED' as const,
          updatedAt: now,
        })),
        status: 'DELETED',
        updatedAt: now,
      },
      clarity: {
        ...record.clarity,
        status: 'DELETED',
        updatedAt: now,
      },
      provisioningStatus: 'DISCONNECTED',
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

  private async withAnalyticsLock<T>(
    input: AnalyticsProvisionInput,
    operation: string,
    fn: (lockedInput: AnalyticsProvisionInput) => Promise<T>,
  ): Promise<T> {
    const operationId = createOperationId(operation, input);
    const resourceId = `${input.tenantId}:${input.customerId}`;

    try {
      await this.lockService.acquire({
        resourceType: 'analytics',
        resourceId,
        ttlSeconds: env.analyticsLockTtlSeconds,
        owner: {
          tenantId: input.tenantId,
          actorId: input.actorId,
          requestId: input.requestId,
          operationId,
        },
      });
    } catch (error) {
      if (error instanceof DistributedLockConflictError) {
        await this.writeAudit(input, 'LOCK_CONFLICT', {
          operation,
          resourceType: 'analytics',
          resourceId,
          activeOperationId: error.lock?.operationId,
          expiresAt: error.lock?.expiresAt,
        });
        throw new AppError(
          'Analytics provisioning is already running for this customer',
          409,
          'ANALYTICS_LOCK_CONFLICT',
          {
            activeOperationId: error.lock?.operationId,
            lockExpiresAt: error.lock?.expiresAt,
          },
        );
      }

      throw error;
    }

    await this.writeAudit(input, 'LOCK_ACQUIRED', {
      operation,
      resourceType: 'analytics',
      resourceId,
      operationId,
    });

    const existing = await this.repository.getByCustomerId(input.customerId);
    if (existing && existing.tenantId === input.tenantId) {
      await this.repository.upsert({
        ...existing,
        activeOperationId: operationId,
        activeCorrelationId: input.requestId,
        updatedAt: nowIso(),
      });
    }

    try {
      return await fn({
        ...input,
        requestId: input.requestId || operationId,
        idempotencyKey: input.idempotencyKey || operationId,
      });
    } finally {
      await this.lockService.release({
        resourceType: 'analytics',
        resourceId,
        operationId,
      });
    }
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
        googleAds: existing.googleAds ?? initialGoogleAds(),
        provisioningStatus: existing.provisioningStatus ?? 'PENDING',
        provisioningErrors: existing.provisioningErrors ?? [],
        retryMetadata: existing.retryMetadata ?? {},
        timeline: existing.timeline ?? [],
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
      googleAds: initialGoogleAds(),
      clarity: initialClarity(),
      provisioningStatus: 'NOT_STARTED',
      provisioningErrors: [],
      retryMetadata: {},
      timeline: [],
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
        status: 'SUCCEEDED',
        updatedAt: now,
      },
      trackingEnvironment: buildTrackingEnvironment({
        measurementId: result.measurementId,
        searchConsoleVerificationToken: record.searchConsole.verificationToken,
        googleAds: record.googleAds.customerId
          ? {
              customerId: record.googleAds.customerId,
              conversionId: record.googleAds.conversionId,
              conversions: record.googleAds.conversions,
            }
          : undefined,
        clarityProjectId: record.clarity.projectId,
      }),
      provisioningStatus: 'RUNNING',
      timeline: this.appendTimeline(record, 'GOOGLE_ANALYTICS', 'SUCCEEDED'),
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
        status: result.verified ? 'SUCCEEDED' : 'PENDING',
        updatedAt: now,
      },
      trackingEnvironment: buildTrackingEnvironment({
        measurementId: record.googleAnalytics.measurementId,
        searchConsoleVerificationToken: result.verificationToken,
        googleAds: record.googleAds.customerId
          ? {
              customerId: record.googleAds.customerId,
              conversionId: record.googleAds.conversionId,
              conversions: record.googleAds.conversions,
            }
          : undefined,
        clarityProjectId: record.clarity.projectId,
      }),
      provisioningStatus: 'RUNNING',
      timeline: this.appendTimeline(record, 'SEARCH_CONSOLE', result.verified ? 'SUCCEEDED' : 'PENDING'),
      updatedAt: now,
    };
  }

  private mergeGoogleAds(
    record: AnalyticsIntegrationRecord,
    result: GoogleAdsProvisionResult,
  ): AnalyticsIntegrationRecord {
    const now = nowIso();

    return {
      ...record,
      googleAds: {
        customerId: result.customerId,
        conversionId: result.conversionId,
        conversions: result.conversions,
        enhancedConversionsEnabled: true,
        status: 'SUCCEEDED',
        updatedAt: now,
      },
      trackingEnvironment: buildTrackingEnvironment({
        measurementId: record.googleAnalytics.measurementId,
        searchConsoleVerificationToken: record.searchConsole.verificationToken,
        googleAds: result,
        clarityProjectId: record.clarity.projectId,
      }),
      provisioningStatus: 'RUNNING',
      timeline: this.appendTimeline(record, 'GOOGLE_ADS', 'SUCCEEDED'),
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
            status: 'SUCCEEDED' as const,
            updatedAt: now,
          };

    return {
      ...record,
      clarity,
      trackingEnvironment: buildTrackingEnvironment({
        measurementId: record.googleAnalytics.measurementId,
        searchConsoleVerificationToken: record.searchConsole.verificationToken,
        googleAds: record.googleAds.customerId
          ? {
              customerId: record.googleAds.customerId,
              conversionId: record.googleAds.conversionId,
              conversions: record.googleAds.conversions,
            }
          : undefined,
        clarityProjectId: clarity.projectId,
      }),
      provisioningStatus: clarity.status === 'SKIPPED' ? record.provisioningStatus : 'RUNNING',
      timeline: this.appendTimeline(record, 'CLARITY', clarity.status),
      updatedAt: now,
    };
  }

  private withProviderFailure(
    record: AnalyticsIntegrationRecord,
    provider: AnalyticsProvider,
    error: unknown,
  ): AnalyticsIntegrationRecord {
    const now = nowIso();
    const errorMessage = error instanceof Error ? error.message : String(error);
    const appError = error instanceof AppError ? error : null;
    const provisioningError: AnalyticsProvisioningError = {
      provider,
      code: appError?.code,
      message: errorMessage,
      occurredAt: now,
      retryable: isRetryableError(error),
      correlationId: record.activeCorrelationId,
    };

    if (provider === 'GOOGLE_ANALYTICS') {
      return {
        ...record,
        googleAnalytics: {
          ...record.googleAnalytics,
          status: 'FAILED',
          errorMessage,
          updatedAt: now,
        },
        provisioningStatus: 'FAILED',
        provisioningErrors: [...(record.provisioningErrors ?? []), provisioningError],
        timeline: this.appendTimeline(record, provider, 'FAILED', errorMessage),
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
        provisioningStatus: 'FAILED',
        provisioningErrors: [...(record.provisioningErrors ?? []), provisioningError],
        timeline: this.appendTimeline(record, provider, 'FAILED', errorMessage),
        updatedAt: now,
      };
    }

    if (provider === 'GOOGLE_ADS') {
      return {
        ...record,
        googleAds: {
          ...record.googleAds,
          status: 'FAILED',
          errorMessage,
          updatedAt: now,
        },
        provisioningStatus: 'FAILED',
        provisioningErrors: [...(record.provisioningErrors ?? []), provisioningError],
        timeline: this.appendTimeline(record, provider, 'FAILED', errorMessage),
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
      provisioningStatus: 'FAILED',
      provisioningErrors: [...(record.provisioningErrors ?? []), provisioningError],
      timeline: this.appendTimeline(record, provider, 'FAILED', errorMessage),
      updatedAt: now,
    };
  }

  private withProviderStatus(
    record: AnalyticsIntegrationRecord,
    provider: AnalyticsProvider,
    status: AnalyticsProviderStatus,
  ): AnalyticsIntegrationRecord {
    const now = nowIso();
    const timeline = this.appendTimeline(record, provider, status);

    if (provider === 'GOOGLE_ANALYTICS') {
      return {
        ...record,
        googleAnalytics: { ...record.googleAnalytics, status, updatedAt: now },
        provisioningStatus: status === 'RUNNING' ? 'RUNNING' : record.provisioningStatus,
        timeline,
        updatedAt: now,
      };
    }

    if (provider === 'SEARCH_CONSOLE') {
      return {
        ...record,
        searchConsole: { ...record.searchConsole, status, updatedAt: now },
        provisioningStatus: status === 'RUNNING' ? 'RUNNING' : record.provisioningStatus,
        timeline,
        updatedAt: now,
      };
    }

    if (provider === 'GOOGLE_ADS') {
      return {
        ...record,
        googleAds: { ...record.googleAds, status, updatedAt: now },
        provisioningStatus: status === 'RUNNING' ? 'RUNNING' : record.provisioningStatus,
        timeline,
        updatedAt: now,
      };
    }

    return {
      ...record,
      clarity: { ...record.clarity, status, updatedAt: now },
      provisioningStatus: status === 'RUNNING' ? 'RUNNING' : record.provisioningStatus,
      timeline,
      updatedAt: now,
    };
  }

  private appendTimeline(
    record: AnalyticsIntegrationRecord,
    provider: AnalyticsProvider | 'TRACKING_INJECTION',
    status: AnalyticsProviderStatus,
    message?: string,
  ) {
    return [
      ...(record.timeline ?? []),
      {
        provider,
        status,
        message,
        at: nowIso(),
      },
    ].slice(-50);
  }

  private withProviderSkipped(
    record: AnalyticsIntegrationRecord,
    provider: AnalyticsProvider,
    error: unknown,
  ): AnalyticsIntegrationRecord {
    const now = nowIso();
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (provider === 'GOOGLE_ANALYTICS') {
      return {
        ...record,
        googleAnalytics: {
          ...record.googleAnalytics,
          status: 'SKIPPED',
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
          status: 'SKIPPED',
          verified: false,
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
        status: 'SKIPPED',
        errorMessage,
        updatedAt: now,
      },
      updatedAt: now,
    };
  }

  private isSkippableProviderConfigError(
    provider: string,
    error: unknown,
  ): boolean {
    if (!(error instanceof AppError)) {
      return false;
    }

    return provider === 'CLARITY' && error.code === 'CLARITY_API_NOT_CONFIGURED';
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
            : provider === 'GOOGLE_ADS'
              ? record.googleAds.status
              : record.clarity.status,
    });
  }

  private async withRetry<T>(
    fn: () => Promise<T>,
    provider: string,
    input: AnalyticsProvisionInput,
    maxAttempts = env.analyticsRetryMaxAttempts,
  ): Promise<T> {
    let lastError: unknown;
    let attemptsUsed = 0;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await this.persistRetryMetadata(input, provider as AnalyticsProvider, {
          provider: provider as AnalyticsProvider,
          attempt,
          maxAttempts,
          updatedAt: nowIso(),
        });
        return await fn();
      } catch (error) {
        lastError = error;
        attemptsUsed = attempt;
        if (this.isSkippableProviderConfigError(provider, error)) {
          throw error;
        }

        const retryable = isRetryableError(error);
        const appError = error instanceof AppError ? error : null;
        const delayMs = retryDelayMs(attempt);
        const nextRetryAt = attempt < maxAttempts && retryable ? addMs(delayMs) : undefined;

        logger.exception('Analytics provider attempt failed', error, {
          customerId: input.customerId,
          deploymentId: input.deploymentId,
          domain: normalizeDomain(input.domain),
          provider,
          attempt,
          maxAttempts,
          retryable,
          nextRetryAt,
          correlationId: input.requestId,
        });

        await this.persistRetryMetadata(input, provider as AnalyticsProvider, {
          provider: provider as AnalyticsProvider,
          attempt,
          maxAttempts,
          nextRetryAt,
          lastErrorCode: appError?.code,
          lastErrorMessage: error instanceof Error ? error.message : String(error),
          updatedAt: nowIso(),
        });

        if (nextRetryAt) {
          await this.writeAudit(input, 'ANALYTICS_PROVIDER_RETRY_SCHEDULED', {
            provider,
            attempt,
            maxAttempts,
            nextRetryAt,
            errorCode: appError?.code,
          });
          await sleep(delayMs);
          continue;
        }

        break;
      }
    }

    await this.recordDeadLetter(input, provider, lastError, attemptsUsed || maxAttempts);
    throw lastError;
  }

  private async persistRetryMetadata(
    input: AnalyticsProvisionInput,
    provider: AnalyticsProvider,
    metadata: AnalyticsRetryMetadata,
  ): Promise<void> {
    const record = await this.repository.getByCustomerId(input.customerId);
    if (!record || record.tenantId !== input.tenantId) {
      return;
    }

    await this.repository.upsert({
      ...record,
      retryMetadata: {
        ...(record.retryMetadata ?? {}),
        [provider]: metadata,
      },
      updatedAt: nowIso(),
    });
  }

  private async recordDeadLetter(
    input: AnalyticsProvisionInput,
    provider: string,
    error: unknown,
    attempts: number,
  ): Promise<void> {
    const appError = error instanceof AppError ? error : null;
    const message = error instanceof Error ? error.message : String(error);

    await this.deadLetterRepository
      .create({
        tenantId: input.tenantId,
        resourceType: 'ANALYTICS',
        resourceId: input.customerId,
        customerId: input.customerId,
        deploymentId: input.deploymentId,
        provider,
        errorCode: appError?.code,
        errorMessage: message,
        attempts,
        payload: {
          domain: normalizeDomain(input.domain),
          displayName: input.displayName,
          hostedZoneId: input.hostedZoneId,
          correlationId: input.requestId,
        },
      })
      .then((record) =>
        this.writeAudit(input, 'ANALYTICS_DEAD_LETTERED', {
          provider,
          attempts,
          deadLetterId: record.deadLetterId,
          errorCode: appError?.code,
        }),
      )
      .catch((deadLetterError) => {
        logger.exception('Failed to write analytics dead-letter record', deadLetterError, {
          provider,
          customerId: input.customerId,
          deploymentId: input.deploymentId,
          originalError: message,
        });
      });
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
