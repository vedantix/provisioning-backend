import { Router } from 'express';
import { checkDomainController, addDomainController } from '../controllers/domain.controller';
import { apiKeyMiddleware } from '../middleware/apiKey.middleware';

const router = Router();

router.post('/domains/check', apiKeyMiddleware, checkDomainController);
router.post('/domains', apiKeyMiddleware, addDomainController);

export default router;