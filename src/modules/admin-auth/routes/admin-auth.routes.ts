import { Router, type Request, type Response } from 'express';
import { AdminAuthService } from '../services/admin-auth.service';

const router = Router();
const adminAuthService = new AdminAuthService();

router.post('/admin/auth/login', (req: Request, res: Response) => {
  adminAuthService.verifyPassword(String(req.body?.password || ''));

  const token = adminAuthService.createSessionToken();

  res.status(200).json({
    data: {
      token,
      tokenType: 'Bearer',
      expiresInHours: 24,
    },
    requestId: req.ctx?.requestId,
  });
});

export default router;