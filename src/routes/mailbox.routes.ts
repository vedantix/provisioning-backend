import { Router } from 'express';
import { addMailboxController } from '../controllers/mailbox.controller';
import { apiKeyMiddleware } from '../middleware/apiKey.middleware';

const router = Router();

router.post('/mailboxes', apiKeyMiddleware, addMailboxController);

export default router;