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

function safeJsonParse(text: string): unknown {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function extractErrorMessage(parsed: unknown, status: number): string {
  let message = `Base44 auto-create failed with status ${status}`;

  if (parsed && typeof parsed === 'object') {
    const maybeError = (parsed as { error?: unknown }).error;
    const maybeMessage = (parsed as { message?: unknown }).message;

    if (typeof maybeError === 'string' && maybeError.trim()) {
      message = maybeError;
    } else if (typeof maybeMessage === 'string' && maybeMessage.trim()) {
      message = maybeMessage;
    }
  }

  return message;
}

export class Base44AutoCreateService {
  async createApp(input: Base44CreateAppInput): Promise<Base44CreateAppResult> {
    const slug = slugify(input.companyName || input.domain);

    console.info('[BASE44_AUTO_CREATE] start', {
      customerId: input.customerId,
      companyName: input.companyName,
      domain: input.domain,
      packageCode: input.packageCode,
      niche: input.niche,
      templateKey: input.templateKey,
      enabled: env.base44AutoCreateEnabled,
      hasWebhookUrl: Boolean(env.base44AutoCreateWebhookUrl),
    });

    if (!env.base44AutoCreateEnabled || !env.base44AutoCreateWebhookUrl) {
      const fallback: Base44CreateAppResult = {
        appId: `manual-${slug}`,
        appName: input.companyName,
        editorUrl: '',
        previewUrl: `${env.base44PreviewBaseUrl.replace(/\/$/, '')}/${slug}`,
      };

      console.info('[BASE44_AUTO_CREATE] fallback_manual', fallback);
      return fallback;
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
      const parsed = safeJsonParse(text);

      console.info('[BASE44_AUTO_CREATE] webhook_response', {
        status: response.status,
        ok: response.ok,
        contentType: response.headers.get('content-type'),
        rawPreview: text.slice(0, 500),
      });

      if (!response.ok) {
        const message = extractErrorMessage(parsed, response.status);

        console.error('[BASE44_AUTO_CREATE] webhook_non_ok', {
          status: response.status,
          message,
        });

        throw new Error(message);
      }

      if (!parsed || typeof parsed !== 'object') {
        console.error('[BASE44_AUTO_CREATE] invalid_json_response', {
          rawPreview: text.slice(0, 500),
        });
        throw new Error('Base44 auto-create returned invalid JSON');
      }

      const data = parsed as {
        appId?: unknown;
        appName?: unknown;
        editorUrl?: unknown;
        previewUrl?: unknown;
      };

      if (typeof data.appId !== 'string' || !data.appId.trim()) {
        console.error('[BASE44_AUTO_CREATE] missing_app_id', {
          parsed,
        });
        throw new Error('Base44 auto-create returned no appId');
      }

      const result: Base44CreateAppResult = {
        appId: data.appId,
        appName:
          typeof data.appName === 'string' && data.appName.trim()
            ? data.appName
            : input.companyName,
        editorUrl:
          typeof data.editorUrl === 'string' && data.editorUrl.trim()
            ? data.editorUrl
            : undefined,
        previewUrl:
          typeof data.previewUrl === 'string' && data.previewUrl.trim()
            ? data.previewUrl
            : undefined,
      };

      console.info('[BASE44_AUTO_CREATE] success', result);
      return result;
    } catch (error) {
      console.error('[BASE44_AUTO_CREATE] failed', {
        customerId: input.customerId,
        message: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}