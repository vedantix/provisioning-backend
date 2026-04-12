import axios from 'axios';
import { mailConfig } from '../../../config/mail.config';

type ZohoAccessTokenResponse = {
  access_token: string;
  api_domain?: string;
  token_type?: string;
  expires_in?: number;
};

export class ZohoAuthService {
  private cachedAccessToken: string | null = null;
  private expiresAt = 0;

  async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedAccessToken && now < this.expiresAt - 30_000) {
      return this.cachedAccessToken;
    }

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

    if (!response.data?.access_token) {
      throw new Error('[ZOHO_AUTH] Failed to obtain access token.');
    }

    this.cachedAccessToken = response.data.access_token;
    this.expiresAt = now + (response.data.expires_in || 3600) * 1000;

    return this.cachedAccessToken;
  }
}