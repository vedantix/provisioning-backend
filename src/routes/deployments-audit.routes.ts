import { Router } from 'express';
import { DeploymentsAuditController } from '../controllers/deployments-audit.controller';
import { asyncHandler } from '../middleware/async-handler';

const router = Router();
const controller = new DeploymentsAuditController();

router.get(
  '/deployments/:deploymentId/audit',
  asyncHandler(controller.listAuditEvents),
);

export default router;