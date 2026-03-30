import { Router } from 'express';
import { SystemController } from '../controllers/system.controller';
import { asyncHandler } from '../middleware/async-handler';

const router = Router();
const controller = new SystemController();

router.get('/health', asyncHandler(controller.health));
router.get('/ready', asyncHandler(controller.readiness));

export default router;