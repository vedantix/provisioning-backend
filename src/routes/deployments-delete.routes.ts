import { Router } from 'express';
import { DeploymentsDeleteController } from '../controllers/deployment-delete.controller';
import { asyncHandler } from '../middleware/async-handler';

const router = Router();
const controller = new DeploymentsDeleteController();

router.post(
  '/deployments/:deploymentId/delete',
  asyncHandler(controller.deleteDeployment),
);

export default router;