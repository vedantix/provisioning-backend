import { env } from './env';

function required(name: string, value?: string): string {
  if (!value || !value.trim()) {
    throw new Error(`[MAIL_CONFIG] Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function optionalNumber(value: number | string | undefined, fallback: number): number {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const mailConfig = {
  provider: (env.mailProvider || 'ZOHO').toUpperCase(),
  zoho: {
    apiBaseUrl: env.zohoApiBaseUrl || 'https://mail.zoho.com/api',
    accountsBaseUrl: env.zohoAccountsBaseUrl || 'https://accounts.zoho.com',
    clientId: required('ZOHO_CLIENT_ID', env.zohoClientId),
    clientSecret: required('ZOHO_CLIENT_SECRET', env.zohoClientSecret),
    refreshToken: required('ZOHO_REFRESH_TOKEN', env.zohoRefreshToken),
    organizationId: required('ZOHO_ORGANIZATION_ID', env.zohoOrganizationId),
    tokenTimeoutMs: optionalNumber(env.zohoTokenTimeoutMs, 15000),
    requestTimeoutMs: optionalNumber(env.zohoRequestTimeoutMs, 20000),
  },
} as const;