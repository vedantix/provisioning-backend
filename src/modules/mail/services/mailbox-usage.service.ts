import { getMailPackageRule } from '../package-rules';
import { MailboxService } from './mailbox.service';
import type { MailboxUsageResponse, PackageCode } from '../types/mail.types';

export class MailboxUsageService {
  constructor(private readonly mailboxService = new MailboxService()) {}

  async getUsage(
    customerId: string,
    packageCode: PackageCode,
  ): Promise<MailboxUsageResponse> {
    const rule = getMailPackageRule(packageCode);
    const mailboxes = await this.mailboxService.listByCustomerId(customerId);

    const usedMailboxes = mailboxes.filter(
      (mailbox) => mailbox.status !== 'DELETED',
    ).length;

    const includedMailboxes = rule.includedMailboxes;
    const remainingMailboxes =
      includedMailboxes === Number.MAX_SAFE_INTEGER
        ? Number.MAX_SAFE_INTEGER
        : Math.max(0, includedMailboxes - usedMailboxes);

    return {
      packageCode,
      includedMailboxes,
      usedMailboxes,
      remainingMailboxes,
      extraMailboxPricePerMonth: rule.extraMailboxPricePerMonth,
      suggestedMailboxes: rule.defaultMailboxes,
    };
  }
}
