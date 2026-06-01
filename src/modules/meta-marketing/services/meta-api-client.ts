import crypto from 'node:crypto';
import { env } from '../../../config/env';
import { AppError } from '../../../errors/app-error';

type MetaRequestOptions = {
  method?: 'GET' | 'POST' | 'DELETE';
  token: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown>;
};

function requireMetaConfig(): void {
  if (!env.metaAppId || !env.metaAppSecret) {
    throw new AppError(
      'META_APP_ID and META_APP_SECRET are required for Meta Marketing API',
      500,
      'META_CONFIG_MISSING',
    );
  }
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

export function appSecretProof(token: string): string {
  requireMetaConfig();
  return crypto
    .createHmac('sha256', env.metaAppSecret!)
    .update(token)
    .digest('hex');
}

export class MetaApiClient {
  private readonly baseUrl = trimSlash(env.metaGraphApiBaseUrl);
  private readonly version = env.metaGraphApiVersion.replace(/^\/+/, '');

  async request<T>(path: string, options: MetaRequestOptions): Promise<T> {
    requireMetaConfig();
    const method = options.method || 'GET';
    const url = new URL(`${this.baseUrl}/${this.version}/${path.replace(/^\/+/, '')}`);

    url.searchParams.set('access_token', options.token);
    url.searchParams.set('appsecret_proof', appSecretProof(options.token));

    for (const [key, value] of Object.entries(options.query || {})) {
      if (value !== undefined && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }

    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
      body: method === 'GET' ? undefined : JSON.stringify(options.body || {}),
    });

    const payload = (await response.json().catch(() => null)) as
      | { error?: { message?: string; code?: number; type?: string; error_subcode?: number } }
      | T
      | null;

    if (!response.ok) {
      const maybe = payload as { error?: { message?: string; code?: number; type?: string; error_subcode?: number } } | null;
      throw new AppError(
        maybe?.error?.message || `Meta API request failed (${response.status})`,
        response.status,
        'META_API_ERROR',
        {
          metaCode: maybe?.error?.code,
          metaSubcode: maybe?.error?.error_subcode,
          metaType: maybe?.error?.type,
          path,
        },
      );
    }

    return payload as T;
  }
}
