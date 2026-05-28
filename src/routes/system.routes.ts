import { Router } from 'express';
import { SystemController } from '../controllers/system.controller';
import { asyncHandler } from '../middleware/async-handler';

const router = Router();
const controller = new SystemController();

router.get('/health', asyncHandler(controller.health));
router.get('/health/google', asyncHandler(controller.googleHealth));
router.get('/health/deployments', asyncHandler(controller.deploymentsHealth));
router.get('/health/queues', asyncHandler(controller.queuesHealth));
router.get('/health/provisioning', asyncHandler(controller.provisioningHealth));
router.get('/ready', asyncHandler(controller.readiness));

export default router;
