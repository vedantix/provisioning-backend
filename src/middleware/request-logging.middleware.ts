import type { NextFunction, Request, Response } from 'express';
import { logger } from '../lib/logger';

function getRequestId(req: Request): string | undefined {
  return (
    (req.headers['x-request-id'] as string | undefined) ||
    ((req as Request & { context?: { requestId?: string } }).context?.requestId)
  );
}

function getActorContext(req: Request): {
  tenantId?: string;
  actorId?: string;
  source?: string;
} {
  const context = (req as Request & {
    context?: {
      tenantId?: string;
      actorId?: string;
      source?: string;
    };
  }).context;

  return {
    tenantId: context?.tenantId,
    actorId: context?.actorId,
    source: context?.source,
  };
}

export function requestLoggingMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const startedAt = Date.now();
  const requestId = getRequestId(req);
  const actor = getActorContext(req);

  logger.info('HTTP request started', {
    requestId,
    method: req.method,
    path: req.originalUrl,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    tenantId: actor.tenantId,
    actorId: actor.actorId,
    source: actor.source,
  });

  res.on('finish', () => {
    const durationMs = Date.now() - startedAt;

    logger.info('HTTP request completed', {
      requestId,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs,
      tenantId: actor.tenantId,
      actorId: actor.actorId,
      source: actor.source,
    });
  });

  next();
}