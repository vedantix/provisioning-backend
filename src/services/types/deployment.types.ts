export type DeploymentStage =
  | "DOMAIN_CHECK"
  | "GITHUB_PROVISION"
  | "S3_BUCKET"
  | "ACM_REQUEST"
  | "ACM_VALIDATION_RECORDS"
  | "ACM_WAIT"
  | "CLOUDFRONT"
  | "ROUTE53_ALIAS"
  | "GITHUB_DISPATCH"
  | "DYNAMODB"
  | "SQS";

export type DeploymentStatus =
  | "PENDING"
  | "IN_PROGRESS"
  | "SUCCEEDED"
  | "FAILED"
  | "SKIPPED";

export interface StageResult {
  stage: DeploymentStage;
  status: DeploymentStatus;
  startedAt: string;
  finishedAt?: string;
  message?: string;
  errorCode?: string;
  details?: Record<string, unknown>;
}

export interface DeployRequest {
  customerId: string;
  projectId: string;
  domain: string;
  packageCode: "STARTER" | "GROWTH" | "PRO" | "CUSTOM";
  addOns?: string[];
  initiatedBy?: string;
  force?: boolean;
  metadata?: Record<string, unknown>;
}

export interface DeployResponse {
  success: boolean;
  deploymentId: string;
  jobId?: string;
  domain: string;
  stages: StageResult[];
  data?: {
    repositoryName?: string;
    bucketName?: string;
    certificateArn?: string;
    distributionId?: string;
    distributionDomainName?: string;
    hostedZoneId?: string;
    aliases?: string[];
    workflowRunRequested?: boolean;
  };
}

export interface DeploymentRecord {
  deploymentId: string;
  customerId: string;
  projectId: string;
  domain: string;
  packageCode: string;
  addOns: string[];
  status: "IN_PROGRESS" | "SUCCEEDED" | "FAILED";
  currentStage?: DeploymentStage;
  stages: StageResult[];
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}