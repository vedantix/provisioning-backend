import { Router } from 'express';
import {
  checkDomainController,
  addDomainController,
  inspectDomainController,
} from '../controllers/domain.controller';
import { apiKeyMiddleware } from '../middleware/apiKey.middleware';

const router = Router();

router.post('/domains/inspect', apiKeyMiddleware, inspectDomainController);
router.post('/domains/check', apiKeyMiddleware, checkDomainController);
router.post('/domains', apiKeyMiddleware, addDomainController);

export default router;
