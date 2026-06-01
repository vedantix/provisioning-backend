import crypto from 'node:crypto';
import { AppError, NotFoundError } from '../../../errors/app-error';
import type { MetaAdRecord, MetaCampaignStatus, MetaCreativeRecord, MetaCreativeType } from '../types';
import {
  MetaMarketingRepository,
  metaInternalPk,
  metaSk,
} from '../repositories/meta-marketing.repository';
import { MetaAuthService } from './meta-auth.service';
import { MetaApiClient } from './meta-api-client';
import { MetaAdSetService } from './meta-adset.service';

function nowIso(): string {
  return new Date().toISOString();
}

export class MetaAdService {
  constructor(
    private readonly repository = new MetaMarketingRepository(),
    private readonly auth = new MetaAuthService(repository),
    private readonly api = new MetaApiClient(),
    private readonly adSetService = new MetaAdSetService(repository, auth, api),
  ) {}

  async listCreatives(): Promise<MetaCreativeRecord[]> {
    const creatives = await this.repository.listByType<MetaCreativeRecord>('CREATIVE', 300);
    return creatives.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listAds(adSetId?: string): Promise<MetaAdRecord[]> {
    const ads = await this.repository.listByType<MetaAdRecord>('AD', 300);
    return ads
      .filter((item) => !adSetId || item.adSetId === adSetId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async createCreative(input: {
    tenantId: string;
    actorId?: string;
    type: MetaCreativeType;
    name: string;
    imageUrl?: string;
    videoUrl?: string;
    landingPageUrl: string;
    headline: string;
    description?: string;
    primaryText: string;
    callToAction?: string;
  }): Promise<MetaCreativeRecord> {
    const connection = await this.auth.getConnection(input.tenantId);
    if (!connection.adAccountId || !connection.pageId) {
      throw new AppError('Connect Meta ad account and Facebook Page before creating creatives', 409, 'META_CREATIVE_CONNECTION_REQUIRED');
    }
    const token = await this.auth.getAccessToken(input.tenantId);
    let videoId: string | undefined;

    if (input.type === 'VIDEO') {
      if (!input.videoUrl) {
        throw new AppError('videoUrl is required for video creatives', 400, 'META_VIDEO_URL_REQUIRED');
      }
      const video = await this.api.request<{ id: string }>(`/${connection.adAccountId}/advideos`, {
        method: 'POST',
        token,
        body: {
          file_url: input.videoUrl,
          title: input.name,
        },
      });
      videoId = video.id;
    }

    if (input.type === 'IMAGE' && !input.imageUrl) {
      throw new AppError('imageUrl is required for image creatives', 400, 'META_IMAGE_URL_REQUIRED');
    }

    const objectStorySpec =
      input.type === 'VIDEO'
        ? {
            page_id: connection.pageId,
            instagram_actor_id: connection.instagramId,
            video_data: {
              video_id: videoId,
              message: input.primaryText,
              title: input.headline,
              call_to_action: {
                type: input.callToAction || 'LEARN_MORE',
                value: { link: input.landingPageUrl },
              },
            },
          }
        : {
            page_id: connection.pageId,
            instagram_actor_id: connection.instagramId,
            link_data: {
              link: input.landingPageUrl,
              picture: input.imageUrl,
              message: input.primaryText,
              name: input.headline,
              description: input.description,
              call_to_action: {
                type: input.callToAction || 'LEARN_MORE',
                value: { link: input.landingPageUrl },
              },
            },
          };

    const response = await this.api.request<{ id: string }>(`/${connection.adAccountId}/adcreatives`, {
      method: 'POST',
      token,
      body: {
        name: input.name,
        object_story_spec: objectStorySpec,
      },
    });
    const now = nowIso();
    const creativeId = crypto.randomUUID();
    return this.repository.put({
      pk: metaInternalPk(),
      sk: metaSk('CREATIVE', creativeId),
      entityType: 'CREATIVE',
      tenantId: input.tenantId,
      creativeId,
      metaCreativeId: response.id,
      metaAssetId: videoId,
      type: input.type,
      name: input.name,
      imageUrl: input.imageUrl,
      videoUrl: input.videoUrl,
      landingPageUrl: input.landingPageUrl,
      headline: input.headline,
      description: input.description,
      primaryText: input.primaryText,
      callToAction: input.callToAction || 'LEARN_MORE',
      createdAt: now,
      updatedAt: now,
      createdBy: input.actorId,
      updatedBy: input.actorId,
      lastSyncedAt: now,
    });
  }

  async createAd(input: {
    tenantId: string;
    actorId?: string;
    adSetId: string;
    creativeId: string;
    name: string;
    status?: MetaCampaignStatus;
  }): Promise<MetaAdRecord> {
    const adSet = await this.adSetService.getAdSet(input.adSetId, input.tenantId);
    const creative = await this.getCreative(input.creativeId, input.tenantId);
    if (!adSet.metaAdSetId || !creative.metaCreativeId) {
      throw new AppError('Ad set and creative must be synced with Meta', 409, 'META_AD_DEPENDENCIES_NOT_SYNCED');
    }
    const connection = await this.auth.getConnection(input.tenantId);
    if (!connection.adAccountId) {
      throw new AppError('Connect a Meta ad account before creating ads', 409, 'META_AD_ACCOUNT_REQUIRED');
    }
    const token = await this.auth.getAccessToken(input.tenantId);
    const response = await this.api.request<{ id: string }>(`/${connection.adAccountId}/ads`, {
      method: 'POST',
      token,
      body: {
        name: input.name,
        adset_id: adSet.metaAdSetId,
        creative: { creative_id: creative.metaCreativeId },
        status: input.status === 'ACTIVE' ? 'ACTIVE' : 'PAUSED',
      },
    });
    const now = nowIso();
    const adId = crypto.randomUUID();
    return this.repository.put({
      pk: metaInternalPk(),
      sk: metaSk('AD', adId),
      entityType: 'AD',
      tenantId: input.tenantId,
      adId,
      metaAdId: response.id,
      adSetId: input.adSetId,
      creativeId: input.creativeId,
      name: input.name,
      status: input.status === 'ACTIVE' ? 'ACTIVE' : 'PAUSED',
      createdAt: now,
      updatedAt: now,
      createdBy: input.actorId,
      updatedBy: input.actorId,
      lastSyncedAt: now,
    });
  }

  async updateAdStatus(input: {
    tenantId: string;
    actorId?: string;
    adId: string;
    status: MetaCampaignStatus;
  }): Promise<MetaAdRecord> {
    const record = await this.getAd(input.adId, input.tenantId);
    const token = await this.auth.getAccessToken(input.tenantId);
    if (record.metaAdId) {
      await this.api.request(`/${record.metaAdId}`, {
        method: 'POST',
        token,
        body: {
          status: input.status === 'ACTIVE' ? 'ACTIVE' : input.status === 'ARCHIVED' ? 'ARCHIVED' : 'PAUSED',
        },
      });
    }
    return this.repository.put({
      ...record,
      status: input.status,
      updatedAt: nowIso(),
      updatedBy: input.actorId,
      lastSyncedAt: nowIso(),
    });
  }

  async getCreative(creativeId: string, tenantId: string): Promise<MetaCreativeRecord> {
    const record = await this.repository.get<MetaCreativeRecord>(metaSk('CREATIVE', creativeId));
    if (!record || record.tenantId !== tenantId || record.deletedAt) {
      throw new NotFoundError('Meta creative not found');
    }
    return record;
  }

  async getAd(adId: string, tenantId: string): Promise<MetaAdRecord> {
    const record = await this.repository.get<MetaAdRecord>(metaSk('AD', adId));
    if (!record || record.tenantId !== tenantId || record.deletedAt) {
      throw new NotFoundError('Meta ad not found');
    }
    return record;
  }
}
