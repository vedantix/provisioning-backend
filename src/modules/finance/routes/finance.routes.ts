import { Router } from 'express';
import { FinanceController } from '../controllers/finance.controller';
import { asyncHandler } from '../../../middleware/async-handler';
import { requireAdminAuthMiddleware } from '../../../middleware/require-admin-auth.middleware';
import { requireActorContextMiddleware } from '../../../middleware/require-actor-context.middleware';

const router = Router();
const controller = new FinanceController();

router.use(requireAdminAuthMiddleware);
router.use(requireActorContextMiddleware);

router.post('/customers/bootstrap', asyncHandler(controller.bootstrapCustomer));
router.post('/expenses', asyncHandler(controller.createExpense));
router.get('/overview', asyncHandler(controller.getOverview));
router.get('/customers/:customerId', asyncHandler(controller.getCustomerDetails));

export default router;