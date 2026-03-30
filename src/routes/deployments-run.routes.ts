import { Router } from 'express';
import { DeploymentsRunController } from '../controllers/deployments-run.controller';
import { asyncHandler } from '../middleware/async-handler';

const router = Router();
const controller = new DeploymentsRunController();

router.post(
  '/deployments/:deploymentId/resume',
  asyncHandler(controller.resumeDeployment),
);

export default router;