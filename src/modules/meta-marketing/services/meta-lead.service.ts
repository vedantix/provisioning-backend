import crypto from 'node:crypto';
import { NotFoundError } from '../../../errors/app-error';
import type { MetaLeadActivity, MetaLeadRecord, MetaLeadStatus } from '../types';
import {
  MetaMarketingRepository,
  metaInternalPk,
  metaSk,
} from '../repositories/meta-marketing.repository';
import { MetaAuthService } from './meta-auth.service';
import { MetaApiClient } from './meta-api-client';

type MetaLeadPayload = {
  id?: string;
  created_time?: string;
  ad_id?: string;
  adset_id?: string;
  campaign_id?: string;
  platform?: string;
  field_data?: Array<{ name: string; values?: string[] }>;
};

function nowIso(): string {
  return new Date().toISOString();
}

function field(payload: MetaLeadPayload, names: string[]): string | undefined {
  const normalized = new Set(names.map((item) => item.toLowerCase()));
  const item = payload.field_data?.find((entry) => normalized.has(entry.name.toLowerCase()));
  return item?.values?.[0];
}

export class MetaLeadService {
  constructor(
    private readonly repository = new MetaMarketingRepository(),
    private readonly auth = new MetaAuthService(repository),
    private readonly api = new MetaApiClient(),
  ) {}

  async listLeads(status?: MetaLeadStatus): Promise<MetaLeadRecord[]> {
    const leads = await this.repository.listByType<MetaLeadRecord>('LEAD', 500);
    return leads
      .filter((item) => !status || item.status === status)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async ingestLeadgenId(input: {
    tenantId: string;
    actorId?: string;
    leadgenId: string;
  }): Promise<MetaLeadRecord> {
    const token = await this.auth.getAccessToken(input.tenantId);
    const lead = await this.api.request<MetaLeadPayload>(`/${input.leadgenId}`, {
      token,
      query: {
        fields: 'id,created_time,ad_id,adset_id,campaign_id,platform,field_data',
      },
    });
    return this.upsertLeadFromMetaPayload({
      tenantId: input.tenantId,
      actorId: input.actorId,
      payload: lead,
    });
  }

  async upsertLeadFromMetaPayload(input: {
    tenantId: string;
    actorId?: string;
    payload: MetaLeadPayload;
  }): Promise<MetaLeadRecord> {
    const metaLeadId = input.payload.id || crypto.randomUUID();
    const existing = await this.findByMetaLeadId(metaLeadId);
    const now = nowIso();
    const createdAt = input.payload.created_time || existing?.createdAt || now;
    const leadId = existing?.leadId || crypto.randomUUID();
    const record: MetaLeadRecord = {
      pk: metaInternalPk(),
      sk: metaSk('LEAD', leadId),
      entityType: 'LEAD',
      tenantId: input.tenantId,
      leadId,
      metaLeadId,
      status: existing?.status || 'NEW',
      name: field(input.payload, ['full_name', 'name', 'naam']) || existing?.name,
      email: field(input.payload, ['email', 'e-mail']) || existing?.email,
      phone: field(input.payload, ['phone_number', 'phone', 'telefoon']) || existing?.phone,
      sourceCampaignId: input.payload.campaign_id || existing?.sourceCampaignId,
      sourceAdSetId: input.payload.adset_id || existing?.sourceAdSetId,
      sourceAdId: input.payload.ad_id || existing?.sourceAdId,
      sourcePlatform: input.payload.platform || existing?.sourcePlatform || 'meta',
      dealValue: existing?.dealValue,
      revenue: existing?.revenue,
      wonAt: existing?.wonAt,
      lostReason: existing?.lostReason,
      activities: existing?.activities || [],
      createdAt,
      updatedAt: now,
      createdBy: existing?.createdBy || input.actorId,
      updatedBy: input.actorId,
    };
    return this.repository.put(record);
  }

  async updateLead(input: {
    tenantId: string;
    actorId?: string;
    leadId: string;
    status?: MetaLeadStatus;
    dealValue?: number;
    revenue?: number;
    lostReason?: string;
  }): Promise<MetaLeadRecord> {
    const lead = await this.getLead(input.leadId, input.tenantId);
    const status = input.status ?? lead.status;
    return this.repository.put({
      ...lead,
      status,
      dealValue: input.dealValue ?? lead.dealValue,
      revenue: input.revenue ?? lead.revenue,
      wonAt: status === 'WON' ? lead.wonAt || nowIso() : lead.wonAt,
      lostReason: input.lostReason ?? lead.lostReason,
      updatedAt: nowIso(),
      updatedBy: input.actorId,
    });
  }

  async addActivity(input: {
    tenantId: string;
    actorId?: string;
    leadId: string;
    type: MetaLeadActivity['type'];
    text: string;
    dueAt?: string;
  }): Promise<MetaLeadRecord> {
    const lead = await this.getLead(input.leadId, input.tenantId);
    const activity: MetaLeadActivity = {
      activityId: crypto.randomUUID(),
      type: input.type,
      text: input.text,
      dueAt: input.dueAt,
      createdAt: nowIso(),
      createdBy: input.actorId,
    };
    return this.repository.put({
      ...lead,
      activities: [...lead.activities, activity],
      updatedAt: nowIso(),
      updatedBy: input.actorId,
    });
  }

  async getLead(leadId: string, tenantId: string): Promise<MetaLeadRecord> {
    const lead = await this.repository.get<MetaLeadRecord>(metaSk('LEAD', leadId));
    if (!lead || lead.tenantId !== tenantId || lead.deletedAt) {
      throw new NotFoundError('Meta lead not found');
    }
    return lead;
  }

  private async findByMetaLeadId(metaLeadId: string): Promise<MetaLeadRecord | null> {
    const leads = await this.repository.listByType<MetaLeadRecord>('LEAD', 500);
    return leads.find((lead) => lead.metaLeadId === metaLeadId) || null;
  }
}
