import { env } from '../../../config/env';
import { AppError } from '../../../errors/app-error';
import type { MigrationPageRecord, PageImprovement } from '../types/migration.types';

function extractResponseText(payload: unknown): string {
  const record = payload as Record<string, unknown>;
  if (typeof record.output_text === 'string') return record.output_text;

  const output = Array.isArray(record.output) ? record.output : [];
  const parts: string[] = [];

  for (const item of output) {
    const content = Array.isArray((item as Record<string, unknown>).content)
      ? ((item as Record<string, unknown>).content as unknown[])
      : [];

    for (const part of content) {
      const maybe = part as Record<string, unknown>;
      if (typeof maybe.text === 'string') parts.push(maybe.text);
      if (typeof maybe.output_text === 'string') parts.push(maybe.output_text);
    }
  }

  return parts.join('\n').trim();
}

function safeJsonParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    const match = value.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as T;
    } catch {
      return null;
    }
  }
}

function fallbackImprovement(page: MigrationPageRecord): PageImprovement {
  return {
    heroTitle: page.h1 || page.title || 'Professionele dienstverlening',
    heroSubtitle: page.description,
    improvedSections: page.sections.slice(0, 8),
    improvedSeoTitle: page.title,
    improvedSeoDescription: page.description,
    recommendedCtas: page.ctas,
    notes: ['AI verbetering is niet uitgevoerd omdat OPENAI_API_KEY niet is geconfigureerd.'],
  };
}

export class MigrationAiService {
  isConfigured(): boolean {
    return Boolean(env.openAiApiKey);
  }

  async improvePages(params: {
    pages: MigrationPageRecord[];
    industry?: string;
  }): Promise<MigrationPageRecord[]> {
    if (!this.isConfigured()) {
      return params.pages.map((page) => ({
        ...page,
        aiImprovement: fallbackImprovement(page),
      }));
    }

    const improved: MigrationPageRecord[] = [];

    for (const page of params.pages) {
      improved.push(await this.improvePage(page, params.industry));
    }

    return improved;
  }

  private async improvePage(
    page: MigrationPageRecord,
    industry?: string,
  ): Promise<MigrationPageRecord> {
    const input = {
      industry: industry || 'Niet opgegeven',
      pageType: page.pageType,
      pageUrl: page.pageUrl,
      title: page.title,
      description: page.description,
      h1: page.h1,
      sections: page.sections.slice(0, 8),
      faqs: page.faqs.slice(0, 8),
      ctas: page.ctas.slice(0, 8),
      testimonials: page.testimonials.slice(0, 5),
    };

    const response = await fetch(`${env.openAiApiBaseUrl.replace(/\/+$/, '')}/responses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.openAiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: env.openAiModel,
        input: [
          {
            role: 'system',
            content:
              'Je bent een Nederlandse website content strateeg voor Vedantix. Verbeter bestaande websitecontent voor SEO, conversie en leesbaarheid. Verzin geen diensten, certificeringen, reviews, prijzen of claims die niet in de input staan. Behoud de toon van het bedrijf.',
          },
          {
            role: 'user',
            content: JSON.stringify(input),
          },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'vedantix_migration_page_improvement',
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                heroTitle: { type: 'string' },
                heroSubtitle: { type: 'string' },
                improvedSections: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      heading: { type: 'string' },
                      body: { type: 'string' },
                    },
                    required: ['heading', 'body'],
                  },
                },
                improvedSeoTitle: { type: 'string' },
                improvedSeoDescription: { type: 'string' },
                recommendedCtas: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      label: { type: 'string' },
                      href: { type: 'string' },
                      context: { type: 'string' },
                    },
                    required: ['label', 'context'],
                  },
                },
                notes: { type: 'array', items: { type: 'string' } },
              },
              required: [
                'heroTitle',
                'heroSubtitle',
                'improvedSections',
                'improvedSeoTitle',
                'improvedSeoDescription',
                'recommendedCtas',
                'notes',
              ],
            },
            strict: true,
          },
        },
      }),
    });

    const payload = (await response.json().catch(() => null)) as unknown;
    if (!response.ok) {
      throw new AppError('OpenAI content verbetering is mislukt', 502, 'OPENAI_ERROR', {
        status: response.status,
        pageUrl: page.pageUrl,
      });
    }

    const text = extractResponseText(payload);
    const parsed = safeJsonParse<PageImprovement>(text);
    if (!parsed) {
      throw new AppError('OpenAI response kon niet worden gelezen', 502, 'OPENAI_PARSE_ERROR', {
        pageUrl: page.pageUrl,
      });
    }

    return {
      ...page,
      aiImprovement: {
        heroTitle: parsed.heroTitle,
        heroSubtitle: parsed.heroSubtitle,
        improvedSections: Array.isArray(parsed.improvedSections)
          ? parsed.improvedSections.slice(0, 10)
          : [],
        improvedSeoTitle: parsed.improvedSeoTitle,
        improvedSeoDescription: parsed.improvedSeoDescription,
        recommendedCtas: Array.isArray(parsed.recommendedCtas)
          ? parsed.recommendedCtas.slice(0, 8)
          : [],
        notes: Array.isArray(parsed.notes) ? parsed.notes.slice(0, 10) : [],
      },
    };
  }
}
