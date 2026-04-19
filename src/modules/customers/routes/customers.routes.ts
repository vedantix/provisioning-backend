import { Router } from 'express';
import { CustomersController } from '../controllers/customers.controller';
import { asyncHandler } from '../../../middleware/async-handler';

const router = Router();
const controller = new CustomersController();

router.post('/customers', asyncHandler(controller.createCustomer));
router.get('/customers', asyncHandler(controller.listCustomers));
router.get('/customers/:customerId', asyncHandler(controller.getCustomer));
router.post('/customers/:customerId/base44-app', asyncHandler(controller.linkBase44App));

export default router;