import crypto from 'node:crypto';
import { env } from '../../config/env';
import { AppError } from '../../errors/app-error';
import {
  GoogleOAuthTokenRepository,
  type GoogleOAuthCredentials,
} from './google-oauth-token.repository';

type TokenCacheEntry = {
  accessToken: string;
  expiresAt: number;
};

export type GoogleTokenHealth = {
  ok: boolean;
  mode: 'oauth_refresh_token' | 'service_account';
  errorCode?: string;
  errorMessage?: string;
  reconnectRequired?: boolean;
};

function base64Url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function normalizePrivateKey(value: string): string {
  return value.replace(/\\n/g, '\n');
}

function assertGoogleCredentials(): {
  clientEmail: string;
  privateKey: string;
} {
  if (!env.googleClientEmail || !env.googlePrivateKey) {
    throw new AppError(
      'Google service account credentials are not configured',
      500,
      'GOOGLE_AUTH_CONFIG',
      {
        required: ['GOOGLE_CLIENT_EMAIL', 'GOOGLE_PRIVATE_KEY'],
      },
    );
  }

  return {
    clientEmail: env.googleClientEmail,
    privateKey: normalizePrivateKey(env.googlePrivateKey),
  };
}

export class GoogleServiceAccountAuth {
  private readonly tokenCache = new Map<string, TokenCacheEntry>();

  constructor(
    private readonly tokenUrl = env.googleOauthTokenUrl,
    private readonly oauthTokenRepository = new GoogleOAuthTokenRepository(),
  ) {}

  async getAccessToken(scopes: string[]): Promise<string> {
    const scopeKey = [...new Set(scopes)].sort().join(' ');
    const cached = this.tokenCache.get(scopeKey);
    const nowSeconds = Math.floor(Date.now() / 1000);

    if (cached && cached.expiresAt - 60 > nowSeconds) {
      return cached.accessToken;
    }

    const oauthCredentials = await this.oauthTokenRepository.getOAuthCredentials();

    if (oauthCredentials) {
      return this.getOAuthRefreshTokenAccessToken(
        oauthCredentials,
        scopeKey,
        nowSeconds,
      );
    }

    const credentials = assertGoogleCredentials();
    const assertion = this.buildJwtAssertion(credentials, scopeKey, nowSeconds);

    const response = await fetch(this.tokenUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };

    if (!response.ok || !payload.access_token) {
      throw new AppError(
        payload.error_description || payload.error || 'Google OAuth token request failed',
        response.status || 500,
        'GOOGLE_AUTH_FAILED',
        {
          status: response.status,
          error: payload.error,
        },
      );
    }

    const expiresAt = nowSeconds + (payload.expires_in ?? 3600);
    this.tokenCache.set(scopeKey, {
      accessToken: payload.access_token,
      expiresAt,
    });

    return payload.access_token;
  }

  clearTokenCache(): void {
    this.tokenCache.clear();
    this.oauthTokenRepository.clearCache();
  }

  async validateToken(scopes: string[]): Promise<GoogleTokenHealth> {
    const oauthCredentials = await this.oauthTokenRepository.getOAuthCredentials();
    const mode = oauthCredentials ? 'oauth_refresh_token' : 'service_account';

    try {
      await this.getAccessToken(scopes);
      return { ok: true, mode };
    } catch (error) {
      const appError = error instanceof AppError ? error : null;
      return {
        ok: false,
        mode,
        errorCode: appError?.code,
        errorMessage: error instanceof Error ? error.message : String(error),
        reconnectRequired: appError?.code === 'GOOGLE_OAUTH_RECONNECT_REQUIRED',
      };
    }
  }

  private buildJwtAssertion(
    credentials: { clientEmail: string; privateKey: string },
    scope: string,
    nowSeconds: number,
  ): string {
    const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claim = base64Url(
      JSON.stringify({
        iss: credentials.clientEmail,
        scope,
        aud: this.tokenUrl,
        iat: nowSeconds,
        exp: nowSeconds + 3600,
      }),
    );
    const unsigned = `${header}.${claim}`;
    const signature = crypto
      .createSign('RSA-SHA256')
      .update(unsigned)
      .sign(credentials.privateKey);

    return `${unsigned}.${base64Url(signature)}`;
  }

  private async getOAuthRefreshTokenAccessToken(
    credentials: GoogleOAuthCredentials,
    scopeKey: string,
    nowSeconds: number,
  ): Promise<string> {
    const response = await fetch(this.tokenUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        refresh_token: credentials.refreshToken,
        scope: scopeKey,
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };

    if (!response.ok || !payload.access_token) {
      const reconnectRequired = ['invalid_grant', 'invalid_client', 'unauthorized_client'].includes(
        String(payload.error || ''),
      );
      throw new AppError(
        payload.error_description || payload.error || 'Google OAuth refresh failed',
        response.status || 500,
        reconnectRequired
          ? 'GOOGLE_OAUTH_RECONNECT_REQUIRED'
          : 'GOOGLE_OAUTH_REFRESH_FAILED',
        {
          status: response.status,
          error: payload.error,
          reconnectRequired,
        },
      );
    }

    const expiresAt = nowSeconds + (payload.expires_in ?? 3600);
    this.tokenCache.set(scopeKey, {
      accessToken: payload.access_token,
      expiresAt,
    });

    return payload.access_token;
  }
}
