import axios from 'axios';
import { mailConfig } from '../../../config/mail.config';

type ZohoAccessTokenResponse = {
  access_token?: string;
  api_domain?: string;
  token_type?: string;
  expires_in?: number;
  expires_in_sec?: number;
  error?: string;
  error_description?: string;
};

export class ZohoAuthService {
  private cachedAccessToken: string | null = null;
  private expiresAt = 0;

  async getAccessToken(): Promise<string> {
    console.log('[ZOHO AUTH DEBUG]', {
      accountsBaseUrl: mailConfig.zoho.accountsBaseUrl,
      clientId: mailConfig.zoho.clientId,
      clientSecretLength: mailConfig.zoho.clientSecret.length,
      refreshTokenLength: mailConfig.zoho.refreshToken.length,
    });
    const now = Date.now();

    if (this.cachedAccessToken && now < this.expiresAt - 30_000) {
      return this.cachedAccessToken;
    }

    try {
      const response = await axios.post<ZohoAccessTokenResponse>(
        `${mailConfig.zoho.accountsBaseUrl}/oauth/v2/token`,
        null,
        {
          params: {
            refresh_token: mailConfig.zoho.refreshToken,
            client_id: mailConfig.zoho.clientId,
            client_secret: mailConfig.zoho.clientSecret,
            grant_type: 'refresh_token',
          },
          timeout: mailConfig.zoho.tokenTimeoutMs,
        },
      );

      const accessToken = response.data?.access_token;
      const expiresIn =
        response.data?.expires_in_sec ??
        response.data?.expires_in ??
        3600;

      if (!accessToken) {
        throw new Error(
          `[ZOHO_AUTH] Failed to obtain access token. Response: ${JSON.stringify(response.data)}`
        );
      }

      this.cachedAccessToken = accessToken;
      this.expiresAt = now + expiresIn * 1000;

      return this.cachedAccessToken;
    } catch (error: any) {
      const status = error?.response?.status;
      const data = error?.response?.data;

      throw new Error(
        `[ZOHO_AUTH] Failed to obtain access token. Status=${status ?? 'unknown'} Response=${JSON.stringify(data) || error.message}`
      );
    }
  }
}