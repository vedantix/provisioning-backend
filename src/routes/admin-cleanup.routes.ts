import { Router } from 'express';
import { AdminCleanupController } from '../controllers/admin-cleanup.controller';
import { asyncHandler } from '../middleware/async-handler';
import { requireAdminSourceMiddleware } from '../middleware/require-admin-source.middleware';

const router = Router();
const controller = new AdminCleanupController();

router.use(requireAdminSourceMiddleware);

router.get(
  '/admin/cleanup-candidates',
  asyncHandler(controller.listCleanupCandidates),
);

router.post(
  '/admin/cleanup/run',
  asyncHandler(controller.runCleanup),
);

router.get(
  '/admin/orphans',
  asyncHandler(controller.scanOrphans),
);

router.post(
  '/admin/deployments/:deploymentId/reconcile',
  asyncHandler(controller.reconcileDeployment),
);

router.get(
  '/admin/deployments/:deploymentId/consistency',
  asyncHandler(controller.checkConsistency),
);

export default router;