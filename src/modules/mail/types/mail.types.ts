export type MailProviderCode = 'ZOHO';

export type MailDomainStatus =
  | 'PENDING'
  | 'DNS_PENDING'
  | 'VERIFIED'
  | 'ACTIVE'
  | 'FAILED'
  | 'DISABLED';

export type MailboxStatus =
  | 'PENDING'
  | 'ACTIVE'
  | 'DISABLED'
  | 'DELETED'
  | 'FAILED';

export type BillingState =
  | 'ACTIVE'
  | 'SUSPENDED_NON_PAYMENT'
  | 'CANCELLED';

export type PackageCode = 'STARTER' | 'GROWTH' | 'PRO';

export interface MailDomainRecord {
  id: string;
  customerId?: string | null;
  domain: string;
  provider: MailProviderCode;
  providerDomainId?: string | null;
  status: MailDomainStatus;
  verificationStatus?: string | null;
  mailHostingEnabled: boolean;
  mxVerified: boolean;
  spfVerified: boolean;
  dkimVerified: boolean;
  dmarcVerified: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MailboxRecord {
  id: string;
  customerId?: string | null;
  mailDomainId: string;
  localPart: string;
  primaryEmail: string;
  displayName: string;
  providerUserId?: string | null;
  providerAccountId?: string | null;
  status: MailboxStatus;
  billingState: BillingState;
  includedStorageGb: number;
  extraStorageGb: number;
  passwordSetByCustomer: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateMailDomainInput {
  customerId?: string | null;
  domain: string;
  provider?: MailProviderCode;
}

export interface ReconcileMailDomainInput {
  mailDomainId: string;
}

export interface CreateMailboxInput {
  customerId?: string | null;
  mailDomainId: string;
  localPart: string;
  displayName: string;
  includedStorageGb?: number;
  extraStorageGb?: number;
  password?: string;
}

export interface DisableMailboxInput {
  mailboxId: string;
  reason?: string;
}

export interface EnableMailboxInput {
  mailboxId: string;
}

export interface DeleteMailboxInput {
  mailboxId: string;
}

export interface AddAliasInput {
  mailboxId: string;
  aliasLocalPart: string;
}

export interface ProvisionPackageMailInput {
  customerId: string;
  domain: string;
  packageCode: PackageCode;
}

export interface ProviderDnsRecord {
  type: 'TXT' | 'MX' | 'CNAME' | 'SRV';
  host: string;
  value: string;
  priority?: number;
  ttl?: number;
  purpose?: string;
}

export interface ProviderDomainResult {
  providerDomainId: string;
  domain: string;
  status?: string;
  verificationStatus?: string;
  dnsRecords?: ProviderDnsRecord[];
}

export interface ProviderDomainDetails {
  providerDomainId?: string;
  domain: string;
  status?: string;
  verificationStatus?: string;
  mxVerified?: boolean;
  spfVerified?: boolean;
  dkimVerified?: boolean;
  dmarcVerified?: boolean;
  dnsRecords?: ProviderDnsRecord[];
}

export interface ProviderMailboxResult {
  providerUserId?: string;
  providerAccountId?: string;
  email: string;
  status?: string;
}

export interface MailDomainDnsResponse {
  domain: string;
  records: ProviderDnsRecord[];
}

export interface MailPackageRule {
  includedMailboxes: number;
  defaultMailboxes: string[];
  defaultStorageGb: number;
}

export interface ApiErrorLike {
  message: string;
  statusCode?: number;
  details?: unknown;
}