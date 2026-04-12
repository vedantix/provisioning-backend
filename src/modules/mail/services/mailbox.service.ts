import { MailboxesRepository } from '../repositories/mailboxes.repository';
import { MailDomainService } from './mail-domain.service';
import { ZohoMailProvider } from '../providers/zoho-mail.provider';
import type {
  CreateMailboxInput,
  DeleteMailboxInput,
  DisableMailboxInput,
  EnableMailboxInput,
  MailboxRecord,
} from '../types/mail.types';

export class MailboxService {
  constructor(
    private readonly mailboxesRepository = new MailboxesRepository(),
    private readonly mailDomainService = new MailDomainService(),
    private readonly mailProvider = new ZohoMailProvider(),
  ) {}

  async createMailbox(input: CreateMailboxInput): Promise<MailboxRecord> {
    const mailDomain = await this.mailDomainService.getById(input.mailDomainId);
    if (!mailDomain) {
      throw new Error(`[MAILBOX_SERVICE] Mail domain not found: ${input.mailDomainId}`);
    }

    const localPart = input.localPart.trim().toLowerCase();
    const primaryEmail = `${localPart}@${mailDomain.domain}`;

    const existing = await this.mailboxesRepository.findByEmail(primaryEmail);
    if (existing) {
      return existing;
    }

    const result = await this.mailProvider.createMailbox({
      domain: mailDomain.domain,
      localPart,
      displayName: input.displayName,
      password: input.password,
    });

    return this.mailboxesRepository.create({
      customerId: input.customerId ?? mailDomain.customerId ?? null,
      mailDomainId: input.mailDomainId,
      localPart,
      primaryEmail,
      displayName: input.displayName,
      providerUserId: result.providerUserId || null,
      providerAccountId: result.providerAccountId || null,
      status: 'ACTIVE',
      billingState: 'ACTIVE',
      includedStorageGb: input.includedStorageGb ?? 5,
      extraStorageGb: input.extraStorageGb ?? 0,
      passwordSetByCustomer: false,
    });
  }

  async disableMailbox(input: DisableMailboxInput): Promise<MailboxRecord> {
    const mailbox = await this.mailboxesRepository.findById(input.mailboxId);
    if (!mailbox) {
      throw new Error(`[MAILBOX_SERVICE] Mailbox not found: ${input.mailboxId}`);
    }

    await this.mailProvider.disableMailbox({ email: mailbox.primaryEmail });

    return this.mailboxesRepository.update(mailbox.id, {
      status: 'DISABLED',
      billingState:
        input.reason === 'NON_PAYMENT' ? 'SUSPENDED_NON_PAYMENT' : mailbox.billingState,
    });
  }

  async enableMailbox(input: EnableMailboxInput): Promise<MailboxRecord> {
    const mailbox = await this.mailboxesRepository.findById(input.mailboxId);
    if (!mailbox) {
      throw new Error(`[MAILBOX_SERVICE] Mailbox not found: ${input.mailboxId}`);
    }

    await this.mailProvider.enableMailbox({ email: mailbox.primaryEmail });

    return this.mailboxesRepository.update(mailbox.id, {
      status: 'ACTIVE',
      billingState: 'ACTIVE',
    });
  }

  async deleteMailbox(input: DeleteMailboxInput): Promise<MailboxRecord> {
    const mailbox = await this.mailboxesRepository.findById(input.mailboxId);
    if (!mailbox) {
      throw new Error(`[MAILBOX_SERVICE] Mailbox not found: ${input.mailboxId}`);
    }

    await this.mailProvider.deleteMailbox({ email: mailbox.primaryEmail });

    return this.mailboxesRepository.update(mailbox.id, {
      status: 'DELETED',
      billingState: 'CANCELLED',
    });
  }

  async getMailbox(mailboxId: string): Promise<MailboxRecord | null> {
    return this.mailboxesRepository.findById(mailboxId);
  }

  async listByCustomerId(customerId: string): Promise<MailboxRecord[]> {
    return this.mailboxesRepository.listByCustomerId(customerId);
  }
}