import { Router } from 'express';
import { OperationsController } from '../controllers/operations.controller';
import { asyncHandler } from '../middleware/async-handler';

const router = Router();
const controller = new OperationsController();

router.get('/operations/:operationId', asyncHandler(controller.getOperation));

export default router;