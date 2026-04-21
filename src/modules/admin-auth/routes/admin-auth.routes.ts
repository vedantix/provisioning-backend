import { Router, type Request, type Response } from 'express';
import { AdminAuthService } from '../services/admin-auth.service';
import { env } from '../../../config/env';
import { UnauthorizedError } from '../../../errors/app-error';

const router = Router();
const adminAuthService = new AdminAuthService();

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

  res.status(200).json({
    data: result,
    requestId: req.ctx?.requestId,
  });
});

export default router;