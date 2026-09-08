import net from 'node:net';
import type { NextFunction, Request, Response } from 'express';
import { TooManyRequestsError } from '../../../errors/app-error';

type Entry = {
  count: number;
  resetAt: number;
};

type AuditRateLimitOptions = {
  windowMs: number;
  maxRequests: number;
  globalWindowMs?: number;
  globalMaxRequests?: number;
};

const clientStore = new Map<string, Entry>();
const globalStore = new Map<string, Entry>();
let requestCounter = 0;

function normalizeIp(value?: string | null): string | null {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;

  const withoutBrackets = trimmed.startsWith('[') && trimmed.includes(']')
    ? trimmed.slice(1, trimmed.indexOf(']'))
    : trimmed;

  if (net.isIP(withoutBrackets)) return withoutBrackets.toLowerCase();
  return null;
}

function clientAddress(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  const forwardedValue = Array.isArray(forwarded) ? forwarded.join(',') : forwarded;
  const forwardedAddresses = String(forwardedValue || '')
    .split(',')
    .map((item) => normalizeIp(item))
    .filter((item): item is string => Boolean(item));

  // App Runner/proxies append the directly observed client hop to X-Forwarded-For.
  // Taking the right-most valid address avoids trusting arbitrary left-most values.
  const proxiedClient = forwardedAddresses.length
    ? forwardedAddresses[forwardedAddresses.length - 1]
    : undefined;
  if (proxiedClient) return proxiedClient;

  return (
    normalizeIp(req.socket?.remoteAddress) ||
    normalizeIp(req.ip) ||
    'unknown-client'
  );
}

function cleanupExpired(store: Map<string, Entry>, now: number): void {
  for (const [key, entry] of store.entries()) {
    if (now > entry.resetAt) store.delete(key);
  }
}

function consume(
  store: Map<string, Entry>,
  key: string,
  now: number,
  windowMs: number,
  maxRequests: number,
): { allowed: boolean; resetAt: number } {
  const current = store.get(key);
  if (!current || now > current.resetAt) {
    const resetAt = now + windowMs;
    store.set(key, { count: 1, resetAt });
    return { allowed: true, resetAt };
  }

  if (current.count >= maxRequests) {
    return { allowed: false, resetAt: current.resetAt };
  }

  current.count += 1;
  store.set(key, current);
  return { allowed: true, resetAt: current.resetAt };
}

export function createAuditRateLimitMiddleware(options: AuditRateLimitOptions) {
  if (options.windowMs <= 0 || options.maxRequests <= 0) {
    throw new Error('Audit rate limit windowMs and maxRequests must be positive.');
  }
  if (
    (options.globalWindowMs !== undefined && options.globalWindowMs <= 0) ||
    (options.globalMaxRequests !== undefined && options.globalMaxRequests <= 0)
  ) {
    throw new Error('Global audit rate limit values must be positive.');
  }

  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    requestCounter += 1;
    if (requestCounter % 250 === 0 || clientStore.size > 2_000) {
      cleanupExpired(clientStore, now);
      cleanupExpired(globalStore, now);
    }

    const clientKey = `${clientAddress(req)}:${req.method}:${req.baseUrl || '/api/audit'}`;
    const clientResult = consume(
      clientStore,
      clientKey,
      now,
      options.windowMs,
      options.maxRequests,
    );

    if (!clientResult.allowed) {
      const retryAfterSeconds = Math.max(1, Math.ceil((clientResult.resetAt - now) / 1_000));
      res.setHeader('Retry-After', String(retryAfterSeconds));
      next(
        new TooManyRequestsError(
          'Te veel audits vanaf dezelfde verbinding. Probeer het later opnieuw.',
          { retryAfterSeconds },
        ),
      );
      return;
    }

    if (options.globalWindowMs && options.globalMaxRequests) {
      const globalResult = consume(
        globalStore,
        `${req.method}:${req.baseUrl || '/api/audit'}`,
        now,
        options.globalWindowMs,
        options.globalMaxRequests,
      );
      if (!globalResult.allowed) {
        const retryAfterSeconds = Math.max(1, Math.ceil((globalResult.resetAt - now) / 1_000));
        res.setHeader('Retry-After', String(retryAfterSeconds));
        next(
          new TooManyRequestsError(
            'De auditcapaciteit is tijdelijk volledig benut. Probeer het over enkele minuten opnieuw.',
            { retryAfterSeconds },
          ),
        );
        return;
      }
    }

    next();
  };
}

export function resetAuditRateLimitStateForTests(): void {
  clientStore.clear();
  globalStore.clear();
  requestCounter = 0;
}
