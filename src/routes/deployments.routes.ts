import { Router } from 'express';
import { DeploymentsController } from '../controllers/deployments.controller';
import { asyncHandler } from '../middleware/async-handler';
import { validateCreateDeploymentMiddleware } from '../middleware/validate-create-deployment.middleware';

const router = Router();
const controller = new DeploymentsController();

router.post(
  '/deployments',
  validateCreateDeploymentMiddleware,
  asyncHandler(controller.createDeployment),
);

router.get(
  '/deployments/:deploymentId',
  asyncHandler(controller.getDeployment),
);

export default router;