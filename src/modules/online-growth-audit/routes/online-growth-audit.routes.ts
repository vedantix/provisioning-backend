import { Router } from 'express';
import { asyncHandler } from '../../../middleware/async-handler';
import { requireActorContextMiddleware } from '../../../middleware/require-actor-context.middleware';
import { requireAdminAuthMiddleware } from '../../../middleware/require-admin-auth.middleware';
import { OnlineGrowthAuditController } from '../controllers/online-growth-audit.controller';
import { createAuditCapacityMiddleware } from '../middleware/audit-capacity.middleware';
import { createAuditRateLimitMiddleware } from '../middleware/audit-rate-limit.middleware';

const router = Router();
const controller = new OnlineGrowthAuditController();
const auditTriggerRateLimit = createAuditRateLimitMiddleware({
  // A public audit is intentionally expensive: browser rendering, crawl, PageSpeed
  // and DNS checks. Keep status/PDF reads unrestricted by this dedicated limiter,
  // while allowing a legitimate visitor several retries/reruns.
  windowMs: 60 * 60 * 1_000,
  maxRequests: 5,
  globalWindowMs: 10 * 60 * 1_000,
  globalMaxRequests: 30,
});
const auditCapacityLimit = createAuditCapacityMiddleware({
  // This count lives in DynamoDB, so the guard remains effective when App Runner
  // scales to more than one backend instance.
  maxActiveAudits: 20,
});

router.use(requireActorContextMiddleware);

router.get(
  '/history',
  requireAdminAuthMiddleware,
  asyncHandler(controller.history),
);
router.post(
  '/',
  auditTriggerRateLimit,
  auditCapacityLimit,
  asyncHandler(controller.start),
);
router.post(
  '/:id/rerun',
  auditTriggerRateLimit,
  auditCapacityLimit,
  asyncHandler(controller.rerun),
);
router.get('/:id', asyncHandler(controller.detail));
router.get('/:id/pdf', asyncHandler(controller.downloadPdf));

export default router;
