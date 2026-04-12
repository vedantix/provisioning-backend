import { Router } from 'express';
import { MailController } from '../controllers/mail.controller';

const router = Router();
const controller = new MailController();

router.post('/domains', controller.createDomain);
router.get('/domains/:mailDomainId/dns-records', controller.getDomainDnsRecords);
router.post('/domains/:mailDomainId/reconcile', controller.reconcileDomain);

router.post('/mailboxes', controller.createMailbox);
router.post('/mailboxes/:mailboxId/disable', controller.disableMailbox);
router.post('/mailboxes/:mailboxId/enable', controller.enableMailbox);
router.delete('/mailboxes/:mailboxId', controller.deleteMailbox);

export default router;