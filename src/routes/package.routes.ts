import { Router } from 'express';
import { upgradePackageController } from '../controllers/package.controller';
import { apiKeyMiddleware } from '../middleware/apiKey.middleware';

const router = Router();

router.post('/package-upgrades', apiKeyMiddleware, upgradePackageController);

export default router;