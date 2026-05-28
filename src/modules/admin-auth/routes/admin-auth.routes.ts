import { Router, type CookieOptions, type Request, type Response } from 'express';
import { AdminAuthService } from '../services/admin-auth.service';
import { env } from '../../../config/env';
import { UnauthorizedError } from '../../../errors/app-error';
import {
  ADMIN_SESSION_COOKIE_NAME,
  requireAdminAuthMiddleware,
} from '../../../middleware/require-admin-auth.middleware';

const router = Router();
const adminAuthService = new AdminAuthService();

function adminSessionCookieOptions(): CookieOptions {
  const options: CookieOptions = {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secure: env.isProduction,
    maxAge: env.adminSessionTtlHours * 60 * 60 * 1000,
  };

  if (env.isProduction) {
    options.domain = '.vedantix.nl';
  }

  return options;
}

function setAdminSessionCookie(res: Response, token: string): void {
  res.cookie(ADMIN_SESSION_COOKIE_NAME, token, adminSessionCookieOptions());
}

function clearAdminSessionCookie(res: Response): void {
  const options = adminSessionCookieOptions();
  delete options.maxAge;
  res.clearCookie(ADMIN_SESSION_COOKIE_NAME, options);
}

function assertProvisioningApiKey(req: Request): void {
  const apiKey = String(req.header('X-Api-Key') || '').trim();

  if (!apiKey || apiKey !== env.provisioningApiKey) {
    throw new UnauthorizedError('Invalid provisioning API key');
  }
}

router.post('/admin/auth/bootstrap', async (req: Request, res: Response) => {
  assertProvisioningApiKey(req);

  const user = await adminAuthService.bootstrapAdminUser({
    tenantId: req.ctx.tenantId,
    email: String(req.body?.email || ''),
    password: String(req.body?.password || ''),
    displayName: String(req.body?.displayName || ''),
  });

  res.status(201).json({
    data: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      tenantId: user.tenantId,
      isActive: user.isActive,
    },
    requestId: req.ctx?.requestId,
  });
});

router.post('/admin/auth/login', async (req: Request, res: Response) => {
  const result = await adminAuthService.login({
    tenantId: req.ctx.tenantId,
    email: String(req.body?.email || ''),
    password: String(req.body?.password || ''),
  });

  setAdminSessionCookie(res, result.token);

  res.status(200).json({
    data: result,
    requestId: req.ctx?.requestId,
  });
});

router.post('/admin/auth/logout', (req: Request, res: Response) => {
  clearAdminSessionCookie(res);

  res.status(200).json({
    data: {
      ok: true,
    },
    requestId: req.ctx?.requestId,
  });
});

function verifyAdminSession(req: Request, res: Response): void {
  res.status(200).json({
    data: {
      ok: true,
      tenantId: req.ctx.tenantId,
      actorId: req.ctx.actorId,
      source: req.ctx.source,
    },
    requestId: req.ctx?.requestId,
  });
}

router.get('/admin/auth/verify', requireAdminAuthMiddleware, verifyAdminSession);
router.post('/admin/auth/verify', requireAdminAuthMiddleware, verifyAdminSession);

export default router;
