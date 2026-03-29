import { Router } from 'express';
import { redeployController } from '../controllers/redeploy.controller';
import { apiKeyMiddleware } from '../middleware/apiKey.middleware';

const router = Router();

router.post('/redeploy', apiKeyMiddleware, redeployController);

export default router;