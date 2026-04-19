export type WebsiteBuildStatus =
  | 'NOT_STARTED'
  | 'APP_REQUESTED'
  | 'APP_LINKED'
  | 'BUILD_IN_PROGRESS'
  | 'PREVIEW_READY'
  | 'AWAITING_APPROVAL'
  | 'APPROVED_FOR_PRODUCTION'
  | 'LIVE';

export type Base44AppStatus =
  | 'NOT_CREATED'
  | 'PENDING'
  | 'LINKED';

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
  | 'cancelled';

export type CustomerRecord = {
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

  finance: {
    monthlyRevenueInclVat: number;
    monthlyInfraCostInclVat: number;
    oneTimeSetupInclVat: number;
    vatRate: number;
    currency: 'EUR';
  };

  base44: {
    status: Base44AppStatus;
    appId?: string;
    appName?: string;
    editorUrl?: string;
    previewUrl?: string;
    templateKey?: string;
    niche?: string;
    requestedPrompt?: string;
    linkedAt?: string;
  };

  deployment?: {
    deploymentId?: string;
    status?: string;
    currentStage?: string | null;
    liveDomain?: string;
  };

  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
};

export type CreateCustomerInput = {
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
};

export type LinkBase44AppInput = {
  tenantId: string;
  actorId: string;
  customerId: string;
  appId: string;
  appName?: string;
  editorUrl?: string;
  previewUrl?: string;
  templateKey?: string;
  niche?: string;
  requestedPrompt?: string;
};