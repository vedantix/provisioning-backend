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
  provider: 'MIGADU',
  migadu: {
    apiBaseUrl: env.migaduApiBaseUrl || 'https://admin.migadu.com/api/v1',
    username: required('MIGADU_USERNAME', env.migaduUsername),
    password: required('MIGADU_PASSWORD', env.migaduPassword),
    requestTimeoutMs: optionalNumber(env.migaduRequestTimeoutMs, 20000),
  },
} as const;
