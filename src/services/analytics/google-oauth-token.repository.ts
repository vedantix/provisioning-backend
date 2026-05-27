import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import { env } from '../../config/env';
import { AppError } from '../../errors/app-error';

export type GoogleOAuthCredentials = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  source: 'ENV' | 'SECRETS_MANAGER';
};

type SecretPayload = {
  clientId?: string;
  client_id?: string;
  clientSecret?: string;
  client_secret?: string;
  refreshToken?: string;
  refresh_token?: string;
};

function nonEmpty(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function fromSecretPayload(payload: SecretPayload): GoogleOAuthCredentials | null {
  const clientId = nonEmpty(payload.clientId) || nonEmpty(payload.client_id);
  const clientSecret = nonEmpty(payload.clientSecret) || nonEmpty(payload.client_secret);
  const refreshToken = nonEmpty(payload.refreshToken) || nonEmpty(payload.refresh_token);

  if (!clientId || !clientSecret || !refreshToken) {
    return null;
  }

  return {
    clientId,
    clientSecret,
    refreshToken,
    source: 'SECRETS_MANAGER',
  };
}

export class GoogleOAuthTokenRepository {
  private cachedCredentials?: GoogleOAuthCredentials;

  constructor(
    private readonly client = new SecretsManagerClient({ region: env.awsRegion }),
  ) {}

  async getOAuthCredentials(): Promise<GoogleOAuthCredentials | null> {
    if (this.cachedCredentials) {
      return this.cachedCredentials;
    }

    const secretArn = env.googleOauthSecretArn?.trim();
    if (secretArn) {
      this.cachedCredentials = await this.readFromSecretsManager(secretArn);
      return this.cachedCredentials;
    }

    const clientId = env.googleClientId?.trim();
    const clientSecret = env.googleClientSecret?.trim();
    const refreshToken = env.googleRefreshToken?.trim();

    if (!clientId || !clientSecret || !refreshToken) {
      return null;
    }

    this.cachedCredentials = {
      clientId,
      clientSecret,
      refreshToken,
      source: 'ENV',
    };
    return this.cachedCredentials;
  }

  clearCache(): void {
    this.cachedCredentials = undefined;
  }

  private async readFromSecretsManager(
    secretArn: string,
  ): Promise<GoogleOAuthCredentials> {
    const response = await this.client.send(
      new GetSecretValueCommand({
        SecretId: secretArn,
      }),
    );
    const rawSecret = response.SecretString?.trim();

    if (!rawSecret) {
      throw new AppError(
        'Google OAuth secret is empty',
        500,
        'GOOGLE_OAUTH_SECRET_EMPTY',
        { secretArn },
      );
    }

    let parsed: SecretPayload;
    try {
      parsed = JSON.parse(rawSecret) as SecretPayload;
    } catch {
      throw new AppError(
        'Google OAuth secret must be valid JSON',
        500,
        'GOOGLE_OAUTH_SECRET_INVALID',
        { secretArn },
      );
    }

    const credentials = fromSecretPayload(parsed);
    if (!credentials) {
      throw new AppError(
        'Google OAuth secret must contain clientId, clientSecret and refreshToken',
        500,
        'GOOGLE_OAUTH_SECRET_INCOMPLETE',
        { secretArn },
      );
    }

    return credentials;
  }
}
