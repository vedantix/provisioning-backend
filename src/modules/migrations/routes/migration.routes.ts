import { Router } from 'express';
import { asyncHandler } from '../../../middleware/async-handler';
import { requireAdminAuthMiddleware } from '../../../middleware/require-admin-auth.middleware';
import { requireActorContextMiddleware } from '../../../middleware/require-actor-context.middleware';
import { MigrationController } from '../controllers/migration.controller';

const router = Router();
const controller = new MigrationController();

router.use(requireAdminAuthMiddleware);
router.use(requireActorContextMiddleware);

router.get('/', asyncHandler(controller.list));
router.post('/', asyncHandler(controller.start));
router.get('/:migrationId', asyncHandler(controller.detail));
router.post('/:migrationId/analyze', asyncHandler(controller.analyze));
router.post('/:migrationId/improve', asyncHandler(controller.improve));
router.post('/:migrationId/import', asyncHandler(controller.importPayload));
router.get('/:migrationId/report', asyncHandler(controller.report));
router.get('/:migrationId/report.:format', asyncHandler(controller.downloadReport));

export default router;
