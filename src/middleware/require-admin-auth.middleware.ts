import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';
import { UnauthorizedError } from '../errors/app-error';
import { AdminAuthService } from '../modules/admin-auth/services/admin-auth.service';

const adminAuthService = new AdminAuthService();
export const ADMIN_SESSION_COOKIE_NAME = 'vedantix_admin_session';

function readBearerToken(req: Request): string | null {
  const authorization = String(req.header('Authorization') || '').trim();

  if (!authorization.toLowerCase().startsWith('bearer ')) {
    return null;
  }

  return authorization.slice(7).trim() || null;
}

function readCookieValue(req: Request, name: string): string | null {
  const cookieHeader = String(req.header('Cookie') || '').trim();

  if (!cookieHeader) {
    return null;
  }

  for (const part of cookieHeader.split(';')) {
    const [rawKey, ...rawValueParts] = part.trim().split('=');
    if (rawKey !== name) continue;

    const rawValue = rawValueParts.join('=').trim();
    if (!rawValue) return null;

    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }

  return null;
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
  const cookieToken = readCookieValue(req, ADMIN_SESSION_COOKIE_NAME);

  if (!bearerToken && !cookieToken) {
    next(new UnauthorizedError('Missing admin authorization'));
    return;
  }

  try {
    adminAuthService.verifySessionToken(bearerToken || cookieToken || '');
    next();
  } catch (error) {
    if (bearerToken && cookieToken && bearerToken !== cookieToken) {
      try {
        adminAuthService.verifySessionToken(cookieToken);
        next();
        return;
      } catch {
        // Continue with the original auth failure for clearer diagnostics.
      }
    }

    console.error('[ADMIN_AUTH_VERIFY_FAILED]', {
      path: req.path,
      message: error instanceof Error ? error.message : 'Unknown error',
      hasAuthorizationHeader: Boolean(req.header('Authorization')),
      hasAdminSessionCookie: Boolean(cookieToken),
      tenantId: req.header('X-Tenant-Id'),
      actorId: req.header('X-Actor-Id'),
      source: req.header('X-Source'),
    });

    next(error);
  }
}
