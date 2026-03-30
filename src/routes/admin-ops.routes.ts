import { Router } from 'express';
import { AdminOpsController } from '../controllers/admin-ops.controller';
import { asyncHandler } from '../middleware/async-handler';

const router = Router();
const controller = new AdminOpsController();

router.get('/admin/cleanup-candidates', asyncHandler(controller.listCleanupCandidates));

export default router;