import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';
import { UnauthorizedError } from '../errors/app-error';
import { AdminAuthService } from '../modules/admin-auth/services/admin-auth.service';

const adminAuthService = new AdminAuthService();

function readBearerToken(req: Request): string | null {
  const authorization = String(req.header('Authorization') || '').trim();

  if (!authorization.toLowerCase().startsWith('bearer ')) {
    return null;
  }

  return authorization.slice(7).trim() || null;
}

export function requireAdminAuthMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  const providedApiKey = String(req.header('X-Api-Key') || '').trim();
  if (providedApiKey && providedApiKey === env.provisioningApiKey) {
    next();
    return;
  }

  const bearerToken = readBearerToken(req);
  if (!bearerToken) {
    next(new UnauthorizedError('Missing admin authorization'));
    return;
  }

  try {
    adminAuthService.verifySessionToken(bearerToken);
    next();
  } catch (error) {
    next(error);
  }
}