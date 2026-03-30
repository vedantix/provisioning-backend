import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { SourceType } from '../domain/deployments/types';

export type RequestContext = {
  requestId: string;
  tenantId: string;
  actorId: string;
  source: SourceType;
  idempotencyKey?: string;
};

declare global {
  namespace Express {
    interface Request {
      ctx: RequestContext;
    }
  }
}

function readHeader(req: Request, key: string): string | undefined {
  const value = req.header(key);
  return value?.trim() || undefined;
}

export function requestContextMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const requestId =
    readHeader(req, 'X-Request-Id') ||
    readHeader(req, 'X-Correlation-Id') ||
    crypto.randomUUID();

  const tenantId = readHeader(req, 'X-Tenant-Id') || 'default';
  const actorId = readHeader(req, 'X-Actor-Id') || 'system';
  const source = (readHeader(req, 'X-Source') || 'API') as SourceType;
  const idempotencyKey = readHeader(req, 'Idempotency-Key');

  req.ctx = {
    requestId,
    tenantId,
    actorId,
    source,
    idempotencyKey,
  };

  res.setHeader('X-Request-Id', requestId);
  next();
}