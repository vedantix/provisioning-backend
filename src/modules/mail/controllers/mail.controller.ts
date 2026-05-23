import type { Request, Response } from 'express';
import { MailDomainService } from '../services/mail-domain.service';
import { MailboxService } from '../services/mailbox.service';
import { MailProvisioningService } from '../services/mail-provisioning.service';
import { MailboxUsageService } from '../services/mailbox-usage.service';
import type { PackageCode } from '../types/mail.types';
import { CustomersRepository } from '../../customers/repositories/customers.repository';
import { NotFoundError } from '../../../errors/app-error';

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
    private readonly mailboxUsageService = new MailboxUsageService(),
    private readonly customersRepository = new CustomersRepository(),
  ) {}

  createDomain = async (req: Request, res: Response): Promise<void> => {
    const result = await this.mailDomainService.createDomain({
      customerId: req.body.customerId ?? null,
      domain: req.body.domain,
      provider: 'MIGADU',
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
    const customer = await this.customersRepository.getById(customerId);

    if (!customer || customer.tenantId !== req.ctx.tenantId) {
      throw new NotFoundError('Customer not found');
    }

    const result = await this.mailProvisioningService.provisionPackageMail({
      customerId,
      domain: req.body.domain || customer.domain,
      packageCode: req.body.packageCode || customer.packageCode,
      selectedMailboxes: req.body.selectedMailboxes,
    });

    const updatedCustomer = await this.customersRepository.markMailProvisioned({
      customerId,
      updatedAt: new Date().toISOString(),
      updatedBy: req.ctx.actorId,
      mailDomain: result.mailDomain,
      mailboxes: result.mailboxes,
    });

    res.status(201).json({
      data: {
        ...result,
        customer: updatedCustomer,
      },
      requestId: req.ctx.requestId,
    });
  };

  getMailboxUsage = async (req: Request, res: Response): Promise<void> => {
    const customerId = getSingleParam(req.params.customerId, 'customerId');
    const packageCode = String(req.query.packageCode || 'STARTER') as PackageCode;

    const result = await this.mailboxUsageService.getUsage(
      customerId,
      packageCode,
    );

    res.status(200).json(result);
  };
}
