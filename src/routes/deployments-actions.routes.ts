import { Router } from 'express';
import { DeploymentsActionsController } from '../controllers/deployments-actions.controller';

const router = Router();
const controller = new DeploymentsActionsController();

router.post(
  '/deployments/:deploymentId/redeploy',
  controller.redeployDeployment,
);

router.post(
  '/deployments/:deploymentId/retry/:stage',
  controller.retryStage,
);

router.get(
  '/deployments/:deploymentId/operations',
  controller.listDeploymentOperations,
);

export default router;