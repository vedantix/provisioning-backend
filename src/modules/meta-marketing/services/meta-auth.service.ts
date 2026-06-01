import crypto from 'node:crypto';
import { env } from '../../../config/env';
import { AppError, NotFoundError } from '../../../errors/app-error';
import type { MetaConnectionRecord } from '../types';
import {
  MetaMarketingRepository,
  metaInternalPk,
  metaSk,
} from '../repositories/meta-marketing.repository';
import { MetaTokenCryptoService } from './meta-token-crypto.service';
import { MetaApiClient } from './meta-api-client';

const CONNECTION_ID = 'vedantix-internal';
const CONNECTION_SK = metaSk('CONNECTION', CONNECTION_ID);
const DEFAULT_SCOPES = [
  'ads_management',
  'ads_read',
  'business_management',
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_metadata',
  'instagram_basic',
  'leads_retrieval',
];

type TokenResponse = {
  access_token: string;
  token_type?: string;
  expires_in?: number;
};

type DebugTokenResponse = {
  data?: {
    app_id?: string;
    is_valid?: boolean;
    scopes?: string[];
    expires_at?: number;
    user_id?: string;
  };
};

export class MetaAuthService {
  constructor(
    private readonly repository = new MetaMarketingRepository(),
    private readonly cryptoService = new MetaTokenCryptoService(),
    private readonly api = new MetaApiClient(),
  ) {}

  getAuthorizationUrl(input: {
    redirectUri?: string;
    state?: string;
  } = {}): { url: string; state: string; scopes: string[] } {
    this.assertOauthConfig();
    const state = input.state || crypto.randomUUID();
    const redirectUri = input.redirectUri || env.metaRedirectUri;
    if (!redirectUri) {
      throw new AppError('META_REDIRECT_URI is required', 500, 'META_REDIRECT_URI_MISSING');
    }

    const url = new URL(`https://www.facebook.com/${env.metaGraphApiVersion}/dialog/oauth`);
    url.searchParams.set('client_id', env.metaAppId!);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', DEFAULT_SCOPES.join(','));

    return { url: url.toString(), state, scopes: DEFAULT_SCOPES };
  }

  async connectWithCode(input: {
    code: string;
    redirectUri?: string;
    tenantId: string;
    actorId?: string;
  }): Promise<MetaConnectionRecord> {
    this.assertOauthConfig();
    const redirectUri = input.redirectUri || env.metaRedirectUri;
    if (!redirectUri) {
      throw new AppError('META_REDIRECT_URI is required', 500, 'META_REDIRECT_URI_MISSING');
    }

    const shortLived = await this.oauthRequest<TokenResponse>({
      client_id: env.metaAppId!,
      client_secret: env.metaAppSecret!,
      redirect_uri: redirectUri,
      code: input.code,
    });
    const longLived = await this.oauthRequest<TokenResponse>({
      grant_type: 'fb_exchange_token',
      client_id: env.metaAppId!,
      client_secret: env.metaAppSecret!,
      fb_exchange_token: shortLived.access_token,
    });
    const debug = await this.debugToken(longLived.access_token);
    const now = new Date().toISOString();
    const expiresAt = longLived.expires_in
      ? new Date(Date.now() + longLived.expires_in * 1000).toISOString()
      : debug.data?.expires_at
        ? new Date(debug.data.expires_at * 1000).toISOString()
        : undefined;

    const connection: MetaConnectionRecord = {
      pk: metaInternalPk(),
      sk: CONNECTION_SK,
      entityType: 'CONNECTION',
      tenantId: input.tenantId,
      connectionId: CONNECTION_ID,
      status: debug.data?.is_valid === false ? 'FAILED' : 'CONNECTED',
      encryptedAccessToken: this.cryptoService.encrypt(longLived.access_token),
      tokenExpiresAt: expiresAt,
      tokenScopes: debug.data?.scopes || DEFAULT_SCOPES,
      pixelId: env.metaPixelId,
      createdAt: now,
      updatedAt: now,
      createdBy: input.actorId,
      updatedBy: input.actorId,
      lastValidatedAt: now,
      errorMessage: debug.data?.is_valid === false ? 'Meta token is invalid' : undefined,
    };

    return this.repository.put(connection);
  }

  async updateConnectionAssets(input: {
    tenantId: string;
    actorId?: string;
    businessId?: string;
    businessName?: string;
    adAccountId?: string;
    adAccountName?: string;
    pageId?: string;
    pageName?: string;
    instagramId?: string;
    instagramUsername?: string;
    pixelId?: string;
  }): Promise<MetaConnectionRecord> {
    const current = await this.getConnection(input.tenantId);
    const updated: MetaConnectionRecord = {
      ...current,
      businessId: input.businessId ?? current.businessId,
      businessName: input.businessName ?? current.businessName,
      adAccountId: input.adAccountId ?? current.adAccountId,
      adAccountName: input.adAccountName ?? current.adAccountName,
      pageId: input.pageId ?? current.pageId,
      pageName: input.pageName ?? current.pageName,
      instagramId: input.instagramId ?? current.instagramId,
      instagramUsername: input.instagramUsername ?? current.instagramUsername,
      pixelId: input.pixelId ?? current.pixelId,
      updatedAt: new Date().toISOString(),
      updatedBy: input.actorId,
    };

    return this.repository.put(updated);
  }

  async getConnection(tenantId: string): Promise<MetaConnectionRecord> {
    const record = await this.repository.get<MetaConnectionRecord>(CONNECTION_SK);
    if (!record || record.tenantId !== tenantId || record.deletedAt) {
      throw new NotFoundError('Meta connection not found');
    }
    return record;
  }

  async getConnectionStatus(tenantId: string): Promise<Omit<MetaConnectionRecord, 'encryptedAccessToken'>> {
    const record = await this.repository.get<MetaConnectionRecord>(CONNECTION_SK);
    if (!record || record.tenantId !== tenantId || record.deletedAt) {
      const now = new Date().toISOString();
      return {
        pk: metaInternalPk(),
        sk: CONNECTION_SK,
        entityType: 'CONNECTION',
        tenantId,
        connectionId: CONNECTION_ID,
        status: 'NOT_CONNECTED',
        tokenScopes: [],
        createdAt: now,
        updatedAt: now,
      };
    }

    const { encryptedAccessToken, ...safe } = record;
    return safe;
  }

  async getAccessToken(tenantId: string): Promise<string> {
    const connection = await this.getConnection(tenantId);
    if (!connection.encryptedAccessToken) {
      throw new AppError('Meta access token is missing', 409, 'META_RECONNECT_REQUIRED');
    }
    if (connection.status !== 'CONNECTED') {
      throw new AppError('Meta connection requires reconnect', 409, 'META_RECONNECT_REQUIRED');
    }

    return this.cryptoService.decrypt(connection.encryptedAccessToken);
  }

  async listAssets(tenantId: string): Promise<{
    businesses: unknown[];
    adAccounts: unknown[];
    pages: unknown[];
    instagramAccounts: unknown[];
  }> {
    const token = await this.getAccessToken(tenantId);
    const businesses = await this.api.request<{ data?: unknown[] }>('/me/businesses', {
      token,
      query: { fields: 'id,name,verification_status', limit: 100 },
    });
    const adAccounts = await this.api.request<{ data?: unknown[] }>('/me/adaccounts', {
      token,
      query: { fields: 'id,name,account_status,currency,timezone_name', limit: 100 },
    });
    const pages = await this.api.request<{ data?: unknown[] }>('/me/accounts', {
      token,
      query: { fields: 'id,name,instagram_business_account{id,username}', limit: 100 },
    });
    const instagramAccounts = (pages.data || [])
      .map((page) => (page as { instagram_business_account?: unknown }).instagram_business_account)
      .filter(Boolean);

    return {
      businesses: businesses.data || [],
      adAccounts: adAccounts.data || [],
      pages: pages.data || [],
      instagramAccounts,
    };
  }

  private async debugToken(token: string): Promise<DebugTokenResponse> {
    this.assertOauthConfig();
    const url = new URL(`${env.metaGraphApiBaseUrl}/${env.metaGraphApiVersion}/debug_token`);
    url.searchParams.set('input_token', token);
    url.searchParams.set('access_token', `${env.metaAppId}|${env.metaAppSecret}`);

    const response = await fetch(url);
    const payload = (await response.json().catch(() => null)) as DebugTokenResponse | null;
    if (!response.ok || !payload) {
      throw new AppError('Meta token validation failed', response.status || 500, 'META_TOKEN_DEBUG_FAILED');
    }
    return payload;
  }

  private async oauthRequest<T>(params: Record<string, string>): Promise<T> {
    const url = new URL(`${env.metaGraphApiBaseUrl}/${env.metaGraphApiVersion}/oauth/access_token`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    const response = await fetch(url);
    const payload = (await response.json().catch(() => null)) as T | { error?: { message?: string } } | null;
    const tokenPayload = payload as { access_token?: string; error?: { message?: string } } | null;
    if (!response.ok || !tokenPayload?.access_token) {
      throw new AppError(
        tokenPayload?.error?.message || 'Meta OAuth token exchange failed',
        response.status || 500,
        'META_OAUTH_FAILED',
      );
    }
    return payload as T;
  }

  private assertOauthConfig(): void {
    if (!env.metaAppId || !env.metaAppSecret) {
      throw new AppError(
        'META_APP_ID and META_APP_SECRET are required for Meta OAuth',
        500,
        'META_CONFIG_MISSING',
      );
    }
  }
}
