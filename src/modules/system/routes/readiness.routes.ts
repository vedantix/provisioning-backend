import { Router } from 'express';
import { env } from '../../../config/env';

const router = Router();

router.get('/ready', (_req, res) => {
  res.status(200).json({
    ok: true,
    service: 'provisioning-backend',
    environment: env.nodeEnv,
    timestamp: new Date().toISOString(),
  });
});

export default router;
