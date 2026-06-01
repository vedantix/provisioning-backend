import crypto from 'node:crypto';
import type { MetaDashboardSummary, MetaInsightRecord, MetaLeadRecord } from '../types';
import {
  MetaMarketingRepository,
  metaInternalPk,
  metaSk,
} from '../repositories/meta-marketing.repository';
import { MetaAuthService } from './meta-auth.service';
import { MetaApiClient } from './meta-api-client';

type MetaInsightsResponse = {
  data?: Array<Record<string, unknown>>;
};

function nowIso(): string {
  return new Date().toISOString();
}

function numberValue(value: unknown): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function actionValue(item: Record<string, unknown>, actionType: string): number {
  const actions = Array.isArray(item.actions) ? item.actions : [];
  const match = actions.find((action) => (action as { action_type?: string }).action_type === actionType);
  return numberValue((match as { value?: unknown } | undefined)?.value);
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? Number((numerator / denominator).toFixed(2)) : 0;
}

function pointMap(
  items: Array<{ date: string; value: number }>,
): Array<{ date: string; value: number }> {
  const grouped = new Map<string, number>();
  for (const item of items) {
    grouped.set(item.date, Number(((grouped.get(item.date) || 0) + item.value).toFixed(2)));
  }
  return [...grouped.entries()]
    .map(([date, value]) => ({ date, value }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function pointsToMap(points: Array<{ date: string; value: number }>): Map<string, number> {
  return new Map(points.map((point) => [point.date, point.value]));
}

function combineDatedValues(
  left: Map<string, number>,
  right: Map<string, number>,
  compute: (leftValue: number, rightValue: number) => number,
): Array<{ date: string; value: number }> {
  const dates = new Set([...left.keys(), ...right.keys()]);
  return [...dates]
    .sort((a, b) => a.localeCompare(b))
    .map((date) => ({
      date,
      value: Number(compute(left.get(date) || 0, right.get(date) || 0).toFixed(2)),
    }));
}

export class MetaInsightsService {
  constructor(
    private readonly repository = new MetaMarketingRepository(),
    private readonly auth = new MetaAuthService(repository),
    private readonly api = new MetaApiClient(),
  ) {}

  async syncInsights(input: {
    tenantId: string;
    actorId?: string;
    since: string;
    until: string;
    level?: 'account' | 'campaign' | 'adset' | 'ad';
  }): Promise<MetaInsightRecord[]> {
    const connection = await this.auth.getConnection(input.tenantId);
    if (!connection.adAccountId) {
      return [];
    }
    const token = await this.auth.getAccessToken(input.tenantId);
    const response = await this.api.request<MetaInsightsResponse>(`/${connection.adAccountId}/insights`, {
      token,
      query: {
        level: input.level || 'campaign',
        fields: 'date_start,date_stop,campaign_id,campaign_name,adset_id,ad_id,impressions,reach,clicks,cpc,ctr,cpm,spend,actions',
        time_range: JSON.stringify({ since: input.since, until: input.until }),
        time_increment: 1,
        limit: 500,
      },
    });
    const now = nowIso();
    const records = (response.data || []).map((item) => {
      const insightId = crypto.randomUUID();
      const record: MetaInsightRecord = {
        pk: metaInternalPk(),
        sk: metaSk('INSIGHT', insightId),
        entityType: 'INSIGHT',
        tenantId: input.tenantId,
        insightId,
        level: input.level || 'campaign',
        sourceId: String(item.campaign_id || item.adset_id || item.ad_id || connection.adAccountId),
        dateStart: String(item.date_start || input.since),
        dateStop: String(item.date_stop || input.until),
        impressions: numberValue(item.impressions),
        reach: numberValue(item.reach),
        clicks: numberValue(item.clicks),
        spend: numberValue(item.spend),
        cpc: numberValue(item.cpc),
        ctr: numberValue(item.ctr),
        cpm: numberValue(item.cpm),
        leads: actionValue(item, 'lead') + actionValue(item, 'onsite_conversion.lead_grouped'),
        conversions: actionValue(item, 'offsite_conversion') + actionValue(item, 'purchase'),
        raw: item,
        createdAt: now,
        updatedAt: now,
        createdBy: input.actorId,
        updatedBy: input.actorId,
      };
      return record;
    });

    for (const record of records) {
      await this.repository.put(record);
    }

    return records;
  }

  async dashboard(): Promise<MetaDashboardSummary> {
    const [insights, leads, campaigns] = await Promise.all([
      this.repository.listByType<MetaInsightRecord>('INSIGHT', 1000),
      this.repository.listByType<MetaLeadRecord>('LEAD', 1000),
      this.repository.listByType<any>('CAMPAIGN', 300),
    ]);
    const spend = insights.reduce((sum, item) => sum + item.spend, 0);
    const totalLeads = Math.max(
      leads.length,
      insights.reduce((sum, item) => sum + item.leads, 0),
    );
    const qualifiedLeads = leads.filter((lead) =>
      ['QUALIFIED', 'PROPOSAL_SENT', 'WON'].includes(lead.status),
    ).length;
    const customers = leads.filter((lead) => lead.status === 'WON').length;
    const revenue = leads.reduce((sum, lead) => sum + (lead.revenue || (lead.status === 'WON' ? lead.dealValue || 0 : 0)), 0);
    const profit = revenue - spend;
    const spendPoints = pointMap(insights.map((item) => ({ date: item.dateStart, value: item.spend })));
    const leadPoints = pointMap([
      ...insights.map((item) => ({ date: item.dateStart, value: item.leads })),
      ...leads.map((lead) => ({ date: lead.createdAt.slice(0, 10), value: 1 })),
    ]);
    const revenuePoints = pointMap(leads.map((lead) => ({
      date: (lead.wonAt || lead.updatedAt).slice(0, 10),
      value: lead.revenue || (lead.status === 'WON' ? lead.dealValue || 0 : 0),
    })));
    const spendByDate = pointsToMap(spendPoints);
    const revenueByDate = pointsToMap(revenuePoints);

    return {
      spend,
      leads: totalLeads,
      qualifiedLeads,
      customers,
      revenue,
      profit,
      roas: ratio(revenue, spend),
      cpl: ratio(spend, totalLeads),
      cac: ratio(spend, customers),
      customerConversionRate: ratio(customers * 100, totalLeads),
      activeCampaigns: campaigns.filter((campaign) => campaign.status === 'ACTIVE').length,
      charts: {
        spend: spendPoints,
        leads: leadPoints,
        revenue: revenuePoints,
        profit: combineDatedValues(revenueByDate, spendByDate, (dailyRevenue, dailySpend) => dailyRevenue - dailySpend),
        roas: combineDatedValues(revenueByDate, spendByDate, (dailyRevenue, dailySpend) => ratio(dailyRevenue, dailySpend)),
      },
    };
  }
}
