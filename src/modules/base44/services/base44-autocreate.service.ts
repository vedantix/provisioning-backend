import { env } from '../../../config/env';
import type {
  Base44CreateAppInput,
  Base44CreateAppResult,
} from '../types/base44.types';

function slugify(value: string): string {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export class Base44AutoCreateService {
  async createApp(input: Base44CreateAppInput): Promise<Base44CreateAppResult> {
    if (!env.base44AutoCreateEnabled || !env.base44AutoCreateWebhookUrl) {
      const slug = slugify(input.companyName || input.domain);

      return {
        appId: `manual-${slug}`,
        appName: input.companyName,
        editorUrl: '',
        previewUrl: `${env.base44PreviewBaseUrl.replace(/\/$/, '')}/${slug}`,
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      env.base44AutoCreateTimeoutMs,
    );

    try {
      const response = await fetch(env.base44AutoCreateWebhookUrl, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(env.base44AutoCreateApiKey
            ? { Authorization: `Bearer ${env.base44AutoCreateApiKey}` }
            : {}),
        },
        body: JSON.stringify({
          customerId: input.customerId,
          companyName: input.companyName,
          domain: input.domain,
          packageCode: input.packageCode,
          niche: input.niche,
          templateKey: input.templateKey,
          appPrompt: input.prompt,
        }),
      });

      const text = await response.text();
      const data = text ? JSON.parse(text) : null;

      if (!response.ok) {
        throw new Error(
          data?.error ||
            data?.message ||
            `Base44 auto-create failed with status ${response.status}`,
        );
      }

      if (!data?.appId) {
        throw new Error('Base44 auto-create returned no appId');
      }

      return {
        appId: String(data.appId),
        appName: String(data.appName || input.companyName),
        editorUrl: data.editorUrl ? String(data.editorUrl) : undefined,
        previewUrl: data.previewUrl ? String(data.previewUrl) : undefined,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}