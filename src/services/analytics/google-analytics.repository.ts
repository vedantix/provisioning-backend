import { env } from '../../config/env';
import { NotFoundError } from '../../errors/app-error';
import { AnalyticsIntegrationsRepository } from '../../repositories/analytics-integrations.repository';
import type { GoogleAnalyticsState } from './analytics.types';
import {
  toGoogleAnalyticsProvisioningRecord,
  type GoogleAnalyticsProvisioningRecord,
} from './google-analytics.types';

export class GoogleAnalyticsRepository {
  constructor(
    private readonly integrationsRepository = new AnalyticsIntegrationsRepository(),
  ) {}

  async getByCustomerId(
    customerId: string,
    tenantId: string,
  ): Promise<GoogleAnalyticsProvisioningRecord | null> {
    const record = await this.integrationsRepository.getByCustomerId(customerId);

    if (!record) {
      return null;
    }

    if (record.tenantId !== tenantId) {
      throw new NotFoundError('Google Analytics integration not found');
    }

    return toGoogleAnalyticsProvisioningRecord({
      customerId: record.customerId,
      tenantId: record.tenantId,
      deploymentId: record.deploymentId,
      domain: record.domain,
      accountId: env.googleAnalyticsAccountId,
      state: record.googleAnalytics,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
  }

  async updateState(input: {
    customerId: string;
    tenantId: string;
    state: GoogleAnalyticsState;
  }): Promise<void> {
    const record = await this.integrationsRepository.getByCustomerId(input.customerId);

    if (!record || record.tenantId !== input.tenantId) {
      throw new NotFoundError('Google Analytics integration not found');
    }

    await this.integrationsRepository.upsert({
      ...record,
      googleAnalytics: input.state,
      updatedAt: new Date().toISOString(),
    });
  }
}
