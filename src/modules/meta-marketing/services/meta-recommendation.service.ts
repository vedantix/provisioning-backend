import crypto from 'node:crypto';
import { env } from '../../../config/env';
import { AppError } from '../../../errors/app-error';
import type { MetaRecommendationRecord } from '../types';
import {
  MetaMarketingRepository,
  metaInternalPk,
  metaSk,
} from '../repositories/meta-marketing.repository';
import { MetaInsightsService } from './meta-insights.service';

type AssistantResponse = {
  output_text?: string;
  output?: Array<{
    content?: Array<{ text?: string }>;
  }>;
};

function nowIso(): string {
  return new Date().toISOString();
}

function parseJsonArray(value: string): Array<{
  title: string;
  explanation: string;
  action: MetaRecommendationRecord['action'];
  priority: MetaRecommendationRecord['priority'];
}> {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error('AI response is not an array');
  }
  return parsed.map((item) => {
    const record = item as Record<string, unknown>;
    return {
      title: String(record.title || '').trim(),
      explanation: String(record.explanation || '').trim(),
      action: String(record.action || 'CHANGE_AUDIENCE') as MetaRecommendationRecord['action'],
      priority: String(record.priority || 'MEDIUM') as MetaRecommendationRecord['priority'],
    };
  }).filter((item) => item.title && item.explanation);
}

export class MetaRecommendationService {
  constructor(
    private readonly repository = new MetaMarketingRepository(),
    private readonly insights = new MetaInsightsService(repository),
  ) {}

  async generateAdVariants(input: {
    offer: string;
    audience: string;
    goal: string;
    count?: number;
  }): Promise<Array<{ headline: string; description: string; primaryText: string; cta: string; audienceAngle: string }>> {
    const text = await this.callOpenAi([
      'Maak Meta Ads varianten voor Vedantix. Reageer uitsluitend met JSON array.',
      `Offer: ${input.offer}`,
      `Audience: ${input.audience}`,
      `Goal: ${input.goal}`,
      `Count: ${Math.min(Math.max(input.count || 5, 1), 10)}`,
      'Schema: [{"headline":"","description":"","primaryText":"","cta":"","audienceAngle":""}]',
    ].join('\n'));
    return JSON.parse(text) as Array<{ headline: string; description: string; primaryText: string; cta: string; audienceAngle: string }>;
  }

  async generateRecommendations(input: {
    tenantId: string;
    actorId?: string;
  }): Promise<MetaRecommendationRecord[]> {
    const dashboard = await this.insights.dashboard();
    const text = await this.callOpenAi([
      'Je bent een performance marketeer voor Vedantix. Analyseer deze Meta Ads resultaten en geef acties.',
      'Reageer uitsluitend met JSON array.',
      `Dashboard: ${JSON.stringify(dashboard)}`,
      'Acties toegestaan: INCREASE_BUDGET, DECREASE_BUDGET, PAUSE_CAMPAIGN, DUPLICATE_CAMPAIGN, CHANGE_AUDIENCE.',
      'Schema: [{"title":"","explanation":"","action":"","priority":"LOW|MEDIUM|HIGH"}]',
    ].join('\n'));
    const items = parseJsonArray(text);
    const now = nowIso();
    const records = items.map((item) => {
      const recommendationId = crypto.randomUUID();
      return {
        pk: metaInternalPk(),
        sk: metaSk('RECOMMENDATION', recommendationId),
        entityType: 'RECOMMENDATION' as const,
        tenantId: input.tenantId,
        recommendationId,
        title: item.title,
        explanation: item.explanation,
        action: item.action,
        priority: item.priority,
        status: 'OPEN' as const,
        createdAt: now,
        updatedAt: now,
        createdBy: input.actorId,
        updatedBy: input.actorId,
      };
    });

    for (const record of records) {
      await this.repository.put(record);
    }

    return records;
  }

  async listRecommendations(): Promise<MetaRecommendationRecord[]> {
    const recommendations = await this.repository.listByType<MetaRecommendationRecord>('RECOMMENDATION', 200);
    return recommendations.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  private async callOpenAi(input: string): Promise<string> {
    if (!env.openAiApiKey) {
      throw new AppError('OPENAI_API_KEY is required for AI marketing assistance', 409, 'AI_MARKETING_CONFIG_MISSING');
    }

    const response = await fetch(`${env.openAiApiBaseUrl.replace(/\/+$/, '')}/responses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.openAiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: env.openAiModel,
        input,
      }),
    });
    const payload = (await response.json().catch(() => null)) as AssistantResponse | { error?: { message?: string } } | null;

    if (!response.ok || !payload) {
      throw new AppError(
        (payload as { error?: { message?: string } } | null)?.error?.message || 'AI marketing request failed',
        response.status || 500,
        'AI_MARKETING_API_ERROR',
      );
    }

    const assistant = payload as AssistantResponse;
    return (
      assistant.output_text ||
      assistant.output?.flatMap((item) => item.content || []).map((item) => item.text || '').join('\n') ||
      ''
    ).trim();
  }
}
