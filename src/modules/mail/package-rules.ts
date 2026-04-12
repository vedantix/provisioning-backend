import type { MailPackageRule, PackageCode } from './types/mail.types';

export const PACKAGE_MAIL_RULES: Record<PackageCode, MailPackageRule> = {
  STARTER: {
    includedMailboxes: 1,
    defaultMailboxes: ['info'],
    defaultStorageGb: 5,
  },
  GROWTH: {
    includedMailboxes: 5,
    defaultMailboxes: ['info', 'sales'],
    defaultStorageGb: 5,
  },
  PRO: {
    includedMailboxes: 10,
    defaultMailboxes: ['info', 'sales', 'support'],
    defaultStorageGb: 5,
  },
};

export function getMailPackageRule(packageCode: PackageCode): MailPackageRule {
  return PACKAGE_MAIL_RULES[packageCode];
}