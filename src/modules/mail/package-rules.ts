import type { MailPackageRule, PackageCode } from './types/mail.types';

export const PACKAGE_MAIL_RULES: Record<PackageCode, MailPackageRule> = {
  STARTER: {
    includedMailboxes: 1,
    defaultMailboxes: ['info'],
    defaultStorageGb: 5,
    extraMailboxPricePerMonth: 7,
  },
  GROWTH: {
    includedMailboxes: 5,
    defaultMailboxes: ['info', 'sales', 'support', 'factuur', 'contact'],
    defaultStorageGb: 5,
    extraMailboxPricePerMonth: 7,
  },
  PRO: {
    includedMailboxes: 10,
    defaultMailboxes: ['info', 'sales', 'support', 'factuur', 'contact', 'admin', 'hr', 'planning', 'marketing', 'jobs'],
    defaultStorageGb: 5,
    extraMailboxPricePerMonth: 7,
  },
  CUSTOM: {
    includedMailboxes: Number.MAX_SAFE_INTEGER,
    defaultMailboxes: ['info'],
    defaultStorageGb: 5,
    extraMailboxPricePerMonth: 7,
  },
};

export function getMailPackageRule(packageCode: PackageCode): MailPackageRule {
  const rule = PACKAGE_MAIL_RULES[packageCode];

  if (!rule) {
    throw new Error(`[MAIL_PACKAGE_RULES] Unsupported package code: ${packageCode}`);
  }

  return rule;
}
