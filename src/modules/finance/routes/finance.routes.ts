import { Router } from 'express';
import { FinanceController } from '../controllers/finance.controller';
import { asyncHandler } from '../../../../src/middleware/async-handler';

const router = Router();
const controller = new FinanceController();

router.post('/customers/bootstrap', asyncHandler(controller.bootstrapCustomer));
router.post('/expenses', asyncHandler(controller.createExpense));
router.get('/overview', asyncHandler(controller.getOverview));
router.get('/customers/:customerId', asyncHandler(controller.getCustomerDetails));

export default router;