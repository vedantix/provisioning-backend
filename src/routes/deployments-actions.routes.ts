import { Router } from 'express';
import { DeploymentsActionsController } from '../controllers/deployments-actions.controller';
import { asyncHandler } from '../middleware/async-handler';
import { validateStageParamMiddleware } from '../middleware/validate-stage-param.middleware';

const router = Router();
const controller = new DeploymentsActionsController();

router.post(
  '/deployments/:deploymentId/redeploy',
  asyncHandler(controller.redeployDeployment),
);

router.post(
  '/deployments/:deploymentId/retry/:stage',
  validateStageParamMiddleware,
  asyncHandler(controller.retryStage),
);

router.get(
  '/deployments/:deploymentId/operations',
  asyncHandler(controller.listDeploymentOperations),
);

export default router;