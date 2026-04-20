import { Router } from 'express';
import { asyncHandler } from '../../../middleware/async-handler';
import { Base44WebhookController } from '../controllers/base44-webhook.controller';

const router = Router();
const controller = new Base44WebhookController();

router.post('/base44/export', asyncHandler(controller.receiveExport));

export default router;