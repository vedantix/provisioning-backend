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

    const requestedMailboxes =
      input.selectedMailboxes && input.selectedMailboxes.length > 0
        ? input.selectedMailboxes
        : rule.defaultMailboxes;

    if (
      rule.includedMailboxes !== Number.MAX_SAFE_INTEGER &&
      requestedMailboxes.length > rule.includedMailboxes
    ) {
      throw new Error(
        `[MAIL_PROVISIONING] Package ${input.packageCode} allows a maximum of ${rule.includedMailboxes} mailboxes.`,
      );
    }

    const mailDomain = await this.mailDomainService.createDomain({
      customerId: input.customerId,
      domain: input.domain,
      provider: 'MIGADU',
    });

    const mailboxes: MailboxRecord[] = [];

    for (const localPart of requestedMailboxes) {
      const normalizedLocalPart = localPart.trim().toLowerCase();

      if (!normalizedLocalPart) {
        continue;
      }

      const mailbox = await this.mailboxService.createMailbox({
        customerId: input.customerId,
        mailDomainId: mailDomain.id,
        localPart: normalizedLocalPart,
        displayName: this.buildDefaultDisplayName(
          normalizedLocalPart,
          input.domain,
        ),
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
