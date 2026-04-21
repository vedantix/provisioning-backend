export type CustomerStatus =
  | 'NEW'
  | 'INTAKE'
  | 'IN_PROGRESS'
  | 'WAITING_FOR_CUSTOMER'
  | 'LIVE'
  | 'MAINTENANCE'
  | 'CANCELLED'
  | 'ARCHIVED';

export type WebsiteBuildStatus =
  | 'NOT_STARTED'
  | 'IN_PROGRESS'
  | 'FAILED'
  | 'COMPLETED';

export type Base44Status =
  | 'NOT_STARTED'
  | 'CREATING'
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

export interface DeploymentInfo {
  deploymentId?: string;
  status?: string;
  currentStage?: string | null;
  liveDomain?: string;
}

export interface CustomerRecord {
  id: string;
  tenantId: string;

  companyName: string;
  domain: string;
  packageCode: string;

  status: CustomerStatus;
  websiteBuildStatus: WebsiteBuildStatus;

  createdAt: string;
  updatedAt: string;
  updatedBy: string;

  templateKey?: string;
  niche?: string;
  requestedPrompt?: string;

  base44: Base44Info;
  deployment?: DeploymentInfo;
}