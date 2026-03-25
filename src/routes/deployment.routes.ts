import { Router } from 'express';
import { apiKeyMiddleware } from '../middleware/apiKey.middleware';
import {
  deployController,
  checkDomainController
} from '../controllers/deployment.controller';

const router = Router();

router.use(apiKeyMiddleware);

router.post('/deploy', deployController);
router.post('/domains/check', checkDomainController);

export default router;