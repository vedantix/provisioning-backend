import { Router } from 'express';
import { CustomersController } from '../controllers/customers.controller';
import { asyncHandler } from '../../../middleware/async-handler';
import { requireAdminAuthMiddleware } from '../../../middleware/require-admin-auth.middleware';
import { requireActorContextMiddleware } from '../../../middleware/require-actor-context.middleware';

const router = Router();
const controller = new CustomersController();

router.use(requireAdminAuthMiddleware);
router.use(requireActorContextMiddleware);

router.post('/customers', asyncHandler(controller.createCustomer));
router.get('/customers', asyncHandler(controller.listCustomers));
router.get('/customers/:customerId', asyncHandler(controller.getCustomer));

router.put('/customers/:customerId', asyncHandler(controller.updateCustomer));
router.delete('/customers/:customerId', asyncHandler(controller.deleteCustomer));

router.post('/customers/:customerId/start-build', asyncHandler(controller.startBuildFlow));
router.post('/customers/:customerId/base44-app/auto', asyncHandler(controller.autoCreateBase44App));
router.post('/customers/:customerId/base44-app', asyncHandler(controller.linkBase44App));
router.post('/customers/:customerId/content-sync', asyncHandler(controller.syncCustomerContent));

router.post('/customers/:customerId/preview-ready', asyncHandler(controller.markPreviewReady));
router.post('/customers/:customerId/approve', asyncHandler(controller.markApprovedForProduction));
router.post('/customers/:customerId/deploy', asyncHandler(controller.deployCustomer));

export default router;