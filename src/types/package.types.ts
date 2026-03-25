export type PackageCode = 'STARTER' | 'GROWTH' | 'PRO' | 'CUSTOM';

export type AddOnCode =
  | 'EXTRA_MAILBOX'
  | 'EXTRA_STORAGE'
  | 'BLOG'
  | 'BOOKING'
  | 'ANALYTICS'
  | 'CRM'
  | 'FORMS'
  | 'SEO_PLUS'
  | 'PRIORITY_SUPPORT';

export type ResolvedPlan = {
  packageCode: PackageCode;
  includedMailboxes: number;
  extraMailboxes: number;
  totalMailboxes: number;
  includedStorageGb: number;
  extraStorageGb: number;
  totalStorageGb: number;
  enabledFeatures: string[];
};

export type AddOnInput = {
  code: AddOnCode;
  quantity: number;
};