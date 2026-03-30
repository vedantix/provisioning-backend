import type { NextFunction, Request, Response } from 'express';
import { TooManyRequestsError } from '../errors/app-error';

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const store = new Map<string, RateLimitEntry>();

function getKey(req: Request): string {
  const tenantId = req.ctx?.tenantId ?? 'unknown-tenant';
  const actorId = req.ctx?.actorId ?? 'unknown-actor';
  const path = req.baseUrl + req.path;
  return `${tenantId}:${actorId}:${path}`;
}

export function createRateLimitMiddleware(params?: {
  windowMs?: number;
  maxRequests?: number;
}) {
  const windowMs = params?.windowMs ?? 60_000;
  const maxRequests = params?.maxRequests ?? 30;

  return (req: Request, _res: Response, next: NextFunction) => {
    const key = getKey(req);
    const now = Date.now();
    const current = store.get(key);

    if (!current || now > current.resetAt) {
      store.set(key, {
        count: 1,
        resetAt: now + windowMs,
      });
      next();
      return;
    }

    if (current.count >= maxRequests) {
      next(
        new TooManyRequestsError('Rate limit exceeded', {
          key,
          resetAt: current.resetAt,
        }),
      );
      return;
    }

    current.count += 1;
    store.set(key, current);
    next();
  };
}