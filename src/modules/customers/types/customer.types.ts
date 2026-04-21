export type CustomerStatus =
  | 'lead'
  | 'intake'
  | 'onboarding'
  | 'building'
  | 'awaiting_approval'
  | 'approved'
  | 'provisioning'
  | 'active'
  | 'warning'
  | 'failed'
  | 'paused'
  | 'cancelled'
  | 'archived';

export type WebsiteBuildStatus =
  | 'NOT_STARTED'
  | 'APP_REQUESTED'
  | 'APP_LINKED'
  | 'IN_PROGRESS'
  | 'PREVIEW_READY'
  | 'APPROVED_FOR_PRODUCTION'
  | 'LIVE'
  | 'FAILED'
  | 'COMPLETED';

export type Base44Status =
  | 'NOT_CREATED'
  | 'CREATING'
  | 'LINKED'
  | 'READY'
  | 'FAILED';

export interface Base44Info {
  status: Base44Status;
  appId?: string;
  appName?: string;
  editorUrl?: string;
  previewUrl?: string;
  templateKey?: string;
  niche?: string;
  requestedPrompt?: string;
  linkedAt?: string;
}

export interface PreviewInfo {
  slug?: string;
  path?: string;
  fullUrl?: string;
  targetUrl?: string;
  isIndexed?: boolean;
  isPasswordProtected?: boolean;
  status?: 'NOT_READY' | 'PENDING' | 'READY' | 'ARCHIVED';
  updatedAt?: string;
}

export interface ContentSyncInfo {
  status?: 'NOT_STARTED' | 'SYNCED' | 'FAILED';
  repositoryName?: string;
  branch?: string;
  lastSyncedAt?: string;
  filesCount?: number;
  source?: string;
}

export interface DeploymentInfo {
  deploymentId?: string;
  status?: string;
  currentStage?: string | null;
  liveDomain?: string;
  repositoryName?: string;
  distributionId?: string;
  operationId?: string;
  targetRef?: string;
}

export interface CustomerFinanceInfo {
  monthlyRevenueInclVat: number;
  monthlyInfraCostInclVat: number;
  oneTimeSetupInclVat: number;
  vatRate: number;
  currency: string;
}

export interface CreateCustomerInput {
  tenantId: string;
  createdBy: string;
  companyName: string;
  contactName: string;
  email: string;
  phone?: string;
  domain: string;
  packageCode: string;
  extras?: string[];
  notes?: string;
  address?: string;
  postalCode?: string;
  city?: string;
  country?: string;
  monthlyRevenueInclVat?: number;
  monthlyInfraCostInclVat?: number;
  oneTimeSetupInclVat?: number;
  vatRate?: number;
  templateKey?: string;
  niche?: string;
  requestedPrompt?: string;
}

export interface LinkBase44AppInput {
  tenantId: string;
  customerId: string;
  actorId: string;
  appId: string;
  appName?: string;
  editorUrl?: string;
  previewUrl?: string;
  templateKey?: string;
  niche?: string;
  requestedPrompt?: string;
}

export interface CustomerRecord {
  id: string;
  tenantId: string;

  companyName: string;
  contactName: string;
  email: string;
  phone?: string;
  domain: string;
  packageCode: string;

  extras: string[];
  notes?: string;
  address?: string;
  postalCode?: string;
  city?: string;
  country?: string;

  status: CustomerStatus;
  websiteBuildStatus: WebsiteBuildStatus;

  finance: CustomerFinanceInfo;

  templateKey?: string;
  niche?: string;
  requestedPrompt?: string;

  base44: Base44Info;
  preview: PreviewInfo;
  contentSync?: ContentSyncInfo;
  deployment?: DeploymentInfo;

  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
}