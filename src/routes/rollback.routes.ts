import { Router } from 'express';
import { rollbackController } from '../controllers/rollback.controller';
import { apiKeyMiddleware } from '../middleware/apiKey.middleware';

const router = Router();

router.post('/rollback', apiKeyMiddleware, rollbackController);

export default router;