import { getMailPackageRule } from '../package-rules';
import { MailDomainService } from './mail-domain.service';
import { MailboxService } from './mailbox.service';
import type {
  MailDomainRecord,
  MailboxRecord,
  ProvisionPackageMailInput,
} from '../types/mail.types';

export interface ProvisionPackageMailResult {
  mailDomain: MailDomainRecord;
  mailboxes: MailboxRecord[];
}

export class MailProvisioningService {
  constructor(
    private readonly mailDomainService = new MailDomainService(),
    private readonly mailboxService = new MailboxService(),
  ) {}

  async provisionPackageMail(
    input: ProvisionPackageMailInput,
  ): Promise<ProvisionPackageMailResult> {
    const rule = getMailPackageRule(input.packageCode);

    const mailDomain = await this.mailDomainService.createDomain({
      customerId: input.customerId,
      domain: input.domain,
      provider: 'ZOHO',
    });

    const mailboxes: MailboxRecord[] = [];

    for (const localPart of rule.defaultMailboxes) {
      const mailbox = await this.mailboxService.createMailbox({
        customerId: input.customerId,
        mailDomainId: mailDomain.id,
        localPart,
        displayName: this.buildDefaultDisplayName(localPart, input.domain),
        includedStorageGb: rule.defaultStorageGb,
        extraStorageGb: 0,
      });

      mailboxes.push(mailbox);
    }

    return {
      mailDomain,
      mailboxes,
    };
  }

  private buildDefaultDisplayName(localPart: string, domain: string): string {
    const left = localPart.charAt(0).toUpperCase() + localPart.slice(1);
    return `${left} ${domain}`;
  }
}