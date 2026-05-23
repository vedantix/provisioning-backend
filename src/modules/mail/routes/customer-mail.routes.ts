import { Router } from 'express';
import { MailController } from '../controllers/mail.controller';
import { requireAdminAuthMiddleware } from '../../../middleware/require-admin-auth.middleware';
import { requireActorContextMiddleware } from '../../../middleware/require-actor-context.middleware';

const router = Router();
const controller = new MailController();

router.use(requireAdminAuthMiddleware);
router.use(requireActorContextMiddleware);

router.get('/:customerId/mail-usage', controller.getMailboxUsage);
router.post('/:customerId/provision-mail', controller.provisionCustomerMail);

export default router;
