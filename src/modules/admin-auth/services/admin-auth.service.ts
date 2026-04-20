import crypto from 'node:crypto';
import { env } from '../../../config/env';
import { UnauthorizedError } from '../../../errors/app-error';

type AdminSessionPayload = {
  sub: 'admin';
  iat: number;
  exp: number;
};

function toBase64Url(value: string): string {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function fromBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${padding}`, 'base64').toString('utf8');
}

function sign(value: string): string {
  return crypto
    .createHmac('sha256', env.adminSessionSecret)
    .update(value)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

export class AdminAuthService {
  createSessionToken(): string {
    const nowSeconds = Math.floor(Date.now() / 1000);

    const payload: AdminSessionPayload = {
      sub: 'admin',
      iat: nowSeconds,
      exp: nowSeconds + env.adminSessionTtlHours * 60 * 60,
    };

    const encodedPayload = toBase64Url(JSON.stringify(payload));
    const signature = sign(encodedPayload);

    return `${encodedPayload}.${signature}`;
  }

  verifyPassword(password: string): void {
    if (!password || password !== env.adminPassword) {
      throw new UnauthorizedError('Ongeldig admin wachtwoord');
    }
  }

  verifySessionToken(token: string): AdminSessionPayload {
    if (!token || !token.includes('.')) {
      throw new UnauthorizedError('Ongeldige admin sessie');
    }

    const [encodedPayload, signature] = token.split('.');

    if (!encodedPayload || !signature) {
      throw new UnauthorizedError('Ongeldige admin sessie');
    }

    const expectedSignature = sign(encodedPayload);

    if (signature !== expectedSignature) {
      throw new UnauthorizedError('Ongeldige admin sessie');
    }

    let payload: AdminSessionPayload;

    try {
      payload = JSON.parse(fromBase64Url(encodedPayload)) as AdminSessionPayload;
    } catch {
      throw new UnauthorizedError('Ongeldige admin sessie');
    }

    const nowSeconds = Math.floor(Date.now() / 1000);

    if (!payload?.exp || payload.exp < nowSeconds) {
      throw new UnauthorizedError('Admin sessie is verlopen');
    }

    if (payload.sub !== 'admin') {
      throw new UnauthorizedError('Ongeldige admin sessie');
    }

    return payload;
  }
}