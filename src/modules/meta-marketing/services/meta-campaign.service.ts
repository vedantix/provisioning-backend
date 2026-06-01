import crypto from 'node:crypto';
import { AppError, NotFoundError } from '../../../errors/app-error';
import { logger } from '../../../lib/logger';
import type { MetaCampaignRecord, MetaCampaignStatus } from '../types';
import {
  MetaMarketingRepository,
  metaInternalPk,
  metaSk,
} from '../repositories/meta-marketing.repository';
import { MetaAuthService } from './meta-auth.service';
import { MetaApiClient } from './meta-api-client';

function nowIso(): string {
  return new Date().toISOString();
}

function cents(value?: number): number | undefined {
  if (value === undefined) return undefined;
  return Math.max(0, Math.round(value * 100));
}

export class MetaCampaignService {
  constructor(
    private readonly repository = new MetaMarketingRepository(),
    private readonly auth = new MetaAuthService(repository),
    private readonly api = new MetaApiClient(),
  ) {}

  async listCampaigns(): Promise<MetaCampaignRecord[]> {
    const campaigns = await this.repository.listByType<MetaCampaignRecord>('CAMPAIGN', 200);
    return campaigns.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async createCampaign(input: {
    tenantId: string;
    actorId?: string;
    name: string;
    objective: string;
    status?: MetaCampaignStatus;
    dailyBudget?: number;
    monthlyBudget?: number;
    revenue?: number;
    notes?: string;
  }): Promise<MetaCampaignRecord> {
    const connection = await this.auth.getConnection(input.tenantId);
    if (!connection.adAccountId) {
      throw new AppError('Connect a Meta ad account before creating campaigns', 409, 'META_AD_ACCOUNT_REQUIRED');
    }
    const token = await this.auth.getAccessToken(input.tenantId);
    const metaStatus = input.status === 'ACTIVE' ? 'ACTIVE' : 'PAUSED';
    const response = await this.api.request<{ id: string }>(`/${connection.adAccountId}/campaigns`, {
      method: 'POST',
      token,
      body: {
        name: input.name,
        objective: input.objective,
        buying_type: 'AUCTION',
        status: metaStatus,
        special_ad_categories: [],
      },
    });
    const now = nowIso();
    const campaignId = crypto.randomUUID();
    const record: MetaCampaignRecord = {
      pk: metaInternalPk(),
      sk: metaSk('CAMPAIGN', campaignId),
      entityType: 'CAMPAIGN',
      tenantId: input.tenantId,
      campaignId,
      metaCampaignId: response.id,
      name: input.name,
      objective: input.objective,
      status: metaStatus === 'ACTIVE' ? 'ACTIVE' : 'PAUSED',
      buyingType: 'AUCTION',
      dailyBudget: input.dailyBudget !== undefined ? { amount: input.dailyBudget, currency: 'EUR' } : undefined,
      monthlyBudget: input.monthlyBudget !== undefined ? { amount: input.monthlyBudget, currency: 'EUR' } : undefined,
      revenue: input.revenue,
      notes: input.notes,
      createdAt: now,
      updatedAt: now,
      createdBy: input.actorId,
      updatedBy: input.actorId,
      lastSyncedAt: now,
    };
    logger.info('Meta campaign created', {
      provider: 'META',
      metaCampaignId: response.id,
      campaignId,
      actorId: input.actorId,
    });
    return this.repository.put(record);
  }

  async updateCampaign(input: {
    tenantId: string;
    actorId?: string;
    campaignId: string;
    name?: string;
    objective?: string;
    status?: MetaCampaignStatus;
    dailyBudget?: number;
    monthlyBudget?: number;
    revenue?: number;
    notes?: string;
  }): Promise<MetaCampaignRecord> {
    const record = await this.getCampaign(input.campaignId, input.tenantId);
    const token = await this.auth.getAccessToken(input.tenantId);
    if (record.metaCampaignId) {
      await this.api.request(`/${record.metaCampaignId}`, {
        method: 'POST',
        token,
        body: {
          name: input.name ?? record.name,
          status: this.toMetaStatus(input.status ?? record.status),
        },
      });
    }

    return this.repository.put({
      ...record,
      name: input.name ?? record.name,
      objective: input.objective ?? record.objective,
      status: input.status ?? record.status,
      dailyBudget:
        input.dailyBudget !== undefined
          ? { amount: input.dailyBudget, currency: record.dailyBudget?.currency || 'EUR' }
          : record.dailyBudget,
      monthlyBudget:
        input.monthlyBudget !== undefined
          ? { amount: input.monthlyBudget, currency: record.monthlyBudget?.currency || 'EUR' }
          : record.monthlyBudget,
      revenue: input.revenue ?? record.revenue,
      notes: input.notes ?? record.notes,
      updatedAt: nowIso(),
      updatedBy: input.actorId,
      lastSyncedAt: nowIso(),
    });
  }

  async setCampaignStatus(input: {
    tenantId: string;
    actorId?: string;
    campaignId: string;
    status: MetaCampaignStatus;
  }): Promise<MetaCampaignRecord> {
    return this.updateCampaign(input);
  }

  async duplicateCampaign(input: {
    tenantId: string;
    actorId?: string;
    campaignId: string;
    name?: string;
  }): Promise<MetaCampaignRecord> {
    const source = await this.getCampaign(input.campaignId, input.tenantId);
    return this.createCampaign({
      tenantId: input.tenantId,
      actorId: input.actorId,
      name: input.name || `${source.name} kopie`,
      objective: source.objective,
      status: 'PAUSED',
      dailyBudget: source.dailyBudget?.amount,
      monthlyBudget: source.monthlyBudget?.amount,
      revenue: source.revenue,
      notes: source.notes,
    });
  }

  async getCampaign(campaignId: string, tenantId: string): Promise<MetaCampaignRecord> {
    const record = await this.repository.get<MetaCampaignRecord>(metaSk('CAMPAIGN', campaignId));
    if (!record || record.tenantId !== tenantId || record.deletedAt) {
      throw new NotFoundError('Meta campaign not found');
    }
    return record;
  }

  buildBudgetPayload(input: { dailyBudget?: number; monthlyBudget?: number }): Record<string, number> {
    return {
      ...(cents(input.dailyBudget) !== undefined ? { daily_budget: cents(input.dailyBudget)! } : {}),
      ...(cents(input.monthlyBudget) !== undefined ? { lifetime_budget: cents(input.monthlyBudget)! } : {}),
    };
  }

  private toMetaStatus(status: MetaCampaignStatus): 'ACTIVE' | 'PAUSED' | 'ARCHIVED' {
    if (status === 'ACTIVE') return 'ACTIVE';
    if (status === 'ARCHIVED') return 'ARCHIVED';
    return 'PAUSED';
  }
}
