import crypto from 'node:crypto';
import { AppError, NotFoundError } from '../../../errors/app-error';
import type { MetaAdSetRecord, MetaCampaignStatus, MetaTargeting } from '../types';
import {
  MetaMarketingRepository,
  metaInternalPk,
  metaSk,
} from '../repositories/meta-marketing.repository';
import { MetaAuthService } from './meta-auth.service';
import { MetaApiClient } from './meta-api-client';
import { MetaCampaignService } from './meta-campaign.service';

function nowIso(): string {
  return new Date().toISOString();
}

function cents(value?: number): number | undefined {
  if (value === undefined) return undefined;
  return Math.max(0, Math.round(value * 100));
}

function toMetaTargeting(targeting: MetaTargeting): Record<string, unknown> {
  return {
    age_min: targeting.ageMin,
    age_max: targeting.ageMax,
    geo_locations: {
      countries: targeting.countries?.length ? targeting.countries : ['NL'],
      regions: targeting.regions,
      cities: targeting.cities?.map((key) => ({ key })),
    },
    genders: targeting.genders?.includes('male')
      ? [1]
      : targeting.genders?.includes('female')
        ? [2]
        : undefined,
    flexible_spec: targeting.interests?.length
      ? [{ interests: targeting.interests.map((item) => ({ id: item.id, name: item.name })) }]
      : undefined,
    publisher_platforms: ['facebook', 'instagram'],
    facebook_positions: targeting.placements?.filter((item) => item.startsWith('facebook')).length
      ? targeting.placements.filter((item) => item.startsWith('facebook')).map((item) => item.replace('facebook_', ''))
      : ['feed', 'stories', 'reels'],
    instagram_positions: targeting.placements?.filter((item) => item.startsWith('instagram')).length
      ? targeting.placements.filter((item) => item.startsWith('instagram')).map((item) => item.replace('instagram_', ''))
      : ['stream', 'stories', 'reels'],
  };
}

export class MetaAdSetService {
  constructor(
    private readonly repository = new MetaMarketingRepository(),
    private readonly auth = new MetaAuthService(repository),
    private readonly api = new MetaApiClient(),
    private readonly campaignService = new MetaCampaignService(repository, auth, api),
  ) {}

  async listAdSets(campaignId?: string): Promise<MetaAdSetRecord[]> {
    const adSets = await this.repository.listByType<MetaAdSetRecord>('AD_SET', 300);
    return adSets
      .filter((item) => !campaignId || item.campaignId === campaignId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async createAdSet(input: {
    tenantId: string;
    actorId?: string;
    campaignId: string;
    name: string;
    dailyBudget: number;
    status?: MetaCampaignStatus;
    targeting: MetaTargeting;
    startTime?: string;
    endTime?: string;
    optimizationGoal?: string;
    billingEvent?: string;
    bidStrategy?: string;
  }): Promise<MetaAdSetRecord> {
    const campaign = await this.campaignService.getCampaign(input.campaignId, input.tenantId);
    if (!campaign.metaCampaignId) {
      throw new AppError('Campaign is not synced with Meta', 409, 'META_CAMPAIGN_NOT_SYNCED');
    }
    const connection = await this.auth.getConnection(input.tenantId);
    if (!connection.adAccountId) {
      throw new AppError('Connect a Meta ad account before creating ad sets', 409, 'META_AD_ACCOUNT_REQUIRED');
    }
    const token = await this.auth.getAccessToken(input.tenantId);
    const response = await this.api.request<{ id: string }>(`/${connection.adAccountId}/adsets`, {
      method: 'POST',
      token,
      body: {
        name: input.name,
        campaign_id: campaign.metaCampaignId,
        daily_budget: cents(input.dailyBudget),
        billing_event: input.billingEvent || 'IMPRESSIONS',
        optimization_goal: input.optimizationGoal || 'LEAD_GENERATION',
        bid_strategy: input.bidStrategy || 'LOWEST_COST_WITHOUT_CAP',
        targeting: toMetaTargeting(input.targeting),
        start_time: input.startTime,
        end_time: input.endTime,
        status: input.status === 'ACTIVE' ? 'ACTIVE' : 'PAUSED',
      },
    });

    const now = nowIso();
    const adSetId = crypto.randomUUID();
    return this.repository.put({
      pk: metaInternalPk(),
      sk: metaSk('AD_SET', adSetId),
      entityType: 'AD_SET',
      tenantId: input.tenantId,
      adSetId,
      metaAdSetId: response.id,
      campaignId: input.campaignId,
      name: input.name,
      status: input.status === 'ACTIVE' ? 'ACTIVE' : 'PAUSED',
      dailyBudget: { amount: input.dailyBudget, currency: 'EUR' },
      startTime: input.startTime,
      endTime: input.endTime,
      optimizationGoal: input.optimizationGoal || 'LEAD_GENERATION',
      billingEvent: input.billingEvent || 'IMPRESSIONS',
      bidStrategy: input.bidStrategy || 'LOWEST_COST_WITHOUT_CAP',
      targeting: input.targeting,
      createdAt: now,
      updatedAt: now,
      createdBy: input.actorId,
      updatedBy: input.actorId,
      lastSyncedAt: now,
    });
  }

  async updateAdSet(input: {
    tenantId: string;
    actorId?: string;
    adSetId: string;
    name?: string;
    dailyBudget?: number;
    status?: MetaCampaignStatus;
    targeting?: MetaTargeting;
  }): Promise<MetaAdSetRecord> {
    const record = await this.getAdSet(input.adSetId, input.tenantId);
    const token = await this.auth.getAccessToken(input.tenantId);

    if (record.metaAdSetId) {
      await this.api.request(`/${record.metaAdSetId}`, {
        method: 'POST',
        token,
        body: {
          name: input.name ?? record.name,
          daily_budget: cents(input.dailyBudget ?? record.dailyBudget?.amount),
          status: this.toMetaStatus(input.status ?? record.status),
          targeting: input.targeting ? toMetaTargeting(input.targeting) : undefined,
        },
      });
    }

    return this.repository.put({
      ...record,
      name: input.name ?? record.name,
      dailyBudget:
        input.dailyBudget !== undefined
          ? { amount: input.dailyBudget, currency: record.dailyBudget?.currency || 'EUR' }
          : record.dailyBudget,
      status: input.status ?? record.status,
      targeting: input.targeting ?? record.targeting,
      updatedAt: nowIso(),
      updatedBy: input.actorId,
      lastSyncedAt: nowIso(),
    });
  }

  async getAdSet(adSetId: string, tenantId: string): Promise<MetaAdSetRecord> {
    const record = await this.repository.get<MetaAdSetRecord>(metaSk('AD_SET', adSetId));
    if (!record || record.tenantId !== tenantId || record.deletedAt) {
      throw new NotFoundError('Meta ad set not found');
    }
    return record;
  }

  private toMetaStatus(status: MetaCampaignStatus): 'ACTIVE' | 'PAUSED' | 'ARCHIVED' {
    if (status === 'ACTIVE') return 'ACTIVE';
    if (status === 'ARCHIVED') return 'ARCHIVED';
    return 'PAUSED';
  }
}
