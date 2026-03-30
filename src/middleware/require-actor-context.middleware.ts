import type { NextFunction, Request, Response } from 'express';
import { BadRequestError, UnauthorizedError } from '../errors/app-error';

export function requireActorContextMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  if (!req.ctx) {
    next(new UnauthorizedError('Missing request context'));
    return;
  }

  if (!req.ctx.requestId) {
    next(new BadRequestError('Missing requestId in request context'));
    return;
  }

  if (!req.ctx.tenantId) {
    next(new BadRequestError('Missing X-Tenant-Id header'));
    return;
  }

  if (!req.ctx.actorId) {
    next(new BadRequestError('Missing X-Actor-Id header'));
    return;
  }

  next();
}