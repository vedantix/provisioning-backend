import { env } from './env';

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
    username: env.migaduUsername || '',
    password: env.migaduPassword || '',
    requestTimeoutMs: optionalNumber(env.migaduRequestTimeoutMs, 20000),
  },
} as const;
