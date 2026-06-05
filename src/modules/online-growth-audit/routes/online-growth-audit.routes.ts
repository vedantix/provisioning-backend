import { Router } from 'express';
import { asyncHandler } from '../../../middleware/async-handler';
import { requireActorContextMiddleware } from '../../../middleware/require-actor-context.middleware';
import { requireAdminAuthMiddleware } from '../../../middleware/require-admin-auth.middleware';
import { OnlineGrowthAuditController } from '../controllers/online-growth-audit.controller';

const router = Router();
const controller = new OnlineGrowthAuditController();

router.use(requireActorContextMiddleware);

router.get(
  '/history',
  requireAdminAuthMiddleware,
  asyncHandler(controller.history),
);
router.post('/', asyncHandler(controller.start));
router.get('/:id', asyncHandler(controller.detail));
router.get('/:id/pdf', asyncHandler(controller.downloadPdf));

export default router;
