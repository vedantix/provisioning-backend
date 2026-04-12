import { Router } from 'express';
import { MailController } from '../controllers/mail.controller';

const router = Router();
const controller = new MailController();

router.post('/:customerId/provision-mail', controller.provisionCustomerMail);

export default router;