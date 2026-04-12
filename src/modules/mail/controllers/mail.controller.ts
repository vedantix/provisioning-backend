import type { Request, Response } from 'express';
import { MailDomainService } from '../services/mail-domain.service';
import { MailboxService } from '../services/mailbox.service';
import { MailProvisioningService } from '../services/mail-provisioning.service';

function getSingleParam(value: string | string[] | undefined, name: string): string {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }

  if (Array.isArray(value) && value.length > 0 && value[0]?.trim()) {
    return value[0].trim();
  }

  throw new Error(`[MAIL_CONTROLLER] Missing or invalid route param: ${name}`);
}

export class MailController {
  constructor(
    private readonly mailDomainService = new MailDomainService(),
    private readonly mailboxService = new MailboxService(),
    private readonly mailProvisioningService = new MailProvisioningService(),
  ) {}

  createDomain = async (req: Request, res: Response): Promise<void> => {
    const result = await this.mailDomainService.createDomain({
      customerId: req.body.customerId ?? null,
      domain: req.body.domain,
      provider: 'ZOHO',
    });

    res.status(201).json(result);
  };

  getDomainDnsRecords = async (req: Request, res: Response): Promise<void> => {
    const mailDomainId = getSingleParam(req.params.mailDomainId, 'mailDomainId');

    const result = await this.mailDomainService.getDnsRecords(mailDomainId);
    res.status(200).json(result);
  };

  reconcileDomain = async (req: Request, res: Response): Promise<void> => {
    const mailDomainId = getSingleParam(req.params.mailDomainId, 'mailDomainId');

    const result = await this.mailDomainService.reconcileDomain({
      mailDomainId,
    });

    res.status(200).json(result);
  };

  createMailbox = async (req: Request, res: Response): Promise<void> => {
    const result = await this.mailboxService.createMailbox({
      customerId: req.body.customerId ?? null,
      mailDomainId: req.body.mailDomainId,
      localPart: req.body.localPart,
      displayName: req.body.displayName,
      includedStorageGb: req.body.includedStorageGb,
      extraStorageGb: req.body.extraStorageGb,
      password: req.body.password,
    });

    res.status(201).json(result);
  };

  disableMailbox = async (req: Request, res: Response): Promise<void> => {
    const mailboxId = getSingleParam(req.params.mailboxId, 'mailboxId');

    const result = await this.mailboxService.disableMailbox({
      mailboxId,
      reason: req.body.reason,
    });

    res.status(200).json(result);
  };

  enableMailbox = async (req: Request, res: Response): Promise<void> => {
    const mailboxId = getSingleParam(req.params.mailboxId, 'mailboxId');

    const result = await this.mailboxService.enableMailbox({
      mailboxId,
    });

    res.status(200).json(result);
  };

  deleteMailbox = async (req: Request, res: Response): Promise<void> => {
    const mailboxId = getSingleParam(req.params.mailboxId, 'mailboxId');

    const result = await this.mailboxService.deleteMailbox({
      mailboxId,
    });

    res.status(200).json(result);
  };

  provisionCustomerMail = async (req: Request, res: Response): Promise<void> => {
    const customerId = getSingleParam(req.params.customerId, 'customerId');

    const result = await this.mailProvisioningService.provisionPackageMail({
      customerId,
      domain: req.body.domain,
      packageCode: req.body.packageCode,
    });

    res.status(201).json(result);
  };
}