import { AddOnInput, ResolvedPlan, PackageCode } from '../../types/package.types';

const PACKAGE_CONFIG: Record<PackageCode, { mailboxesIncluded: number; storageGbIncluded: number; features: string[] }> = {
  STARTER: {
    mailboxesIncluded: 1,
    storageGbIncluded: 5,
    features: ['STATIC_SITE', 'SSL', 'CONTACT_FORM']
  },
  GROWTH: {
    mailboxesIncluded: 5,
    storageGbIncluded: 25,
    features: ['STATIC_SITE', 'SSL', 'CONTACT_FORM', 'BLOG', 'ANALYTICS']
  },
  PRO: {
    mailboxesIncluded: 10,
    storageGbIncluded: 100,
    features: ['STATIC_SITE', 'SSL', 'CONTACT_FORM', 'BLOG', 'ANALYTICS', 'BOOKING']
  },
  CUSTOM: {
    mailboxesIncluded: 0,
    storageGbIncluded: 0,
    features: []
  }
};

export function resolvePlan(packageCode: PackageCode, addOns: AddOnInput[]): ResolvedPlan {
  const base = PACKAGE_CONFIG[packageCode];

  let extraMailboxes = 0;
  let extraStorageGb = 0;
  const features = new Set(base.features);

  for (const addOn of addOns) {
    if (addOn.code === 'EXTRA_MAILBOX') {
      extraMailboxes += addOn.quantity;
    }
    if (addOn.code === 'EXTRA_STORAGE') {
      extraStorageGb += addOn.quantity * 10;
    }
    if (['BLOG', 'BOOKING', 'ANALYTICS', 'CRM', 'FORMS', 'SEO_PLUS'].includes(addOn.code)) {
      features.add(addOn.code);
    }
  }

  return {
    packageCode,
    includedMailboxes: base.mailboxesIncluded,
    extraMailboxes,
    totalMailboxes: base.mailboxesIncluded + extraMailboxes,
    includedStorageGb: base.storageGbIncluded,
    extraStorageGb,
    totalStorageGb: base.storageGbIncluded + extraStorageGb,
    enabledFeatures: Array.from(features)
  };
}