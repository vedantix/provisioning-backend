import { Router } from 'express';
import { DeploymentsRollbackController } from '../controllers/deployments-rollback.controller';

const router = Router();
const controller = new DeploymentsRollbackController();

router.post(
  '/deployments/:deploymentId/rollback',
  controller.rollbackDeployment,
);

export default router;