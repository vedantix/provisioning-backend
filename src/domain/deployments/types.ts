export type DeploymentStatus =
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'DELETING'
  | 'DELETED';

export type DeploymentActionType =
  | 'CREATE'
  | 'RESUME'
  | 'RETRY_STAGE'
  | 'REDEPLOY'
  | 'ROLLBACK'
  | 'DELETE'
  | 'ADD_DOMAIN';

export type StageExecutionStatus =
  | 'NOT_STARTED'
  | 'IN_PROGRESS'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'SKIPPED';

export type FailureCategory =
  | 'VALIDATION'
  | 'AWS'
  | 'GITHUB'
  | 'TIMEOUT'
  | 'CONFLICT'
  | 'UNKNOWN';

export type SourceType = 'API' | 'ADMIN_PANEL' | 'WORKER' | 'SYSTEM';

export type DeploymentStage =
  | 'DOMAIN_CHECK'
  | 'GITHUB_PROVISION'
  | 'S3_BUCKET'
  | 'ACM_REQUEST'
  | 'ACM_VALIDATION_RECORDS'
  | 'ACM_DNS_PROPAGATION'
  | 'ACM_WAIT'
  | 'CLOUDFRONT'
  | 'ROUTE53_ALIAS'
  | 'GITHUB_DISPATCH'
  | 'DYNAMODB'
  | 'SQS';

export type DeleteStage =
  | 'DELETE_DOMAIN_ALIAS'
  | 'DISABLE_CLOUDFRONT'
  | 'WAIT_CLOUDFRONT_DISABLED'
  | 'DELETE_CLOUDFRONT'
  | 'EMPTY_S3_BUCKET'
  | 'DELETE_S3_BUCKET'
  | 'DELETE_ACM_VALIDATION_RECORDS'
  | 'DELETE_ACM_CERTIFICATE'
  | 'FINALIZE_DELETE';

export type AnyStage = DeploymentStage | DeleteStage;

export type StageExecutionState = {
  stage: AnyStage;
  status: StageExecutionStatus;
  retryCount: number;
  startedAt?: string;
  completedAt?: string;
  lastExecutionId?: string;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  retryable?: boolean;
  output?: Record<string, unknown>;
};

export type ManagedResources = {
  bucketName?: string;
  bucketRegionalDomainName?: string;
  certificateArn?: string;
  cloudFrontDistributionId?: string;
  cloudFrontDomainName?: string;
  cloudFrontDistributionArn?: string;
  oacId?: string;
  repoName?: string;
  hostedZoneId?: string;
  route53AliasRecords?: string[];
  validationRecordFqdns?: string[];
  workflowRunId?: string;

  resourceTags?: Record<string, string>;
  ownershipToken?: string;
  githubWorkflowFilePath?: string;
  lastGitRefDeployed?: string;
  rollbackRef?: string;

  consistency?: {
    ok: boolean;
    checkedAt: string;
    checks: Array<{
      resource:
        | 'S3_BUCKET'
        | 'ACM_CERTIFICATE'
        | 'CLOUDFRONT'
        | 'ROUTE53_ALIAS';
      ok: boolean;
      reason?: string;
      details?: Record<string, unknown>;
    }>;
  };
};

export type DomainBinding = {
  domain: string;
  rootDomain: string;
  type: 'PRIMARY' | 'SECONDARY' | 'WWW';
  status: 'PENDING' | 'ACTIVE' | 'FAILED' | 'REMOVED';
  certificateCovered: boolean;
  route53Linked: boolean;
  createdAt: string;
  removedAt?: string;
};

export type DeploymentRecord = {
  deploymentId: string;
  tenantId: string;
  customerId: string;
  actionType: DeploymentActionType;
  status: DeploymentStatus;
  domain: string;
  rootDomain: string;
  packageCode: string;
  addOns: string[];
  currentStage?: AnyStage;
  lastSuccessfulStage?: AnyStage;
  failureStage?: AnyStage;
  failureCategory?: FailureCategory;
  idempotencyKey?: string;
  requestHash: string;
  stageStates: Record<string, StageExecutionState>;
  managedResources: ManagedResources;
  domainBindings: DomainBinding[];
  source: SourceType;
  createdBy?: string;
  triggeredBy?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  version: number;
};

export type OperationStatus =
  | 'ACCEPTED'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELLED';

export type OperationRecord = {
  operationId: string;
  deploymentId: string;
  tenantId: string;
  customerId: string;
  type: DeploymentActionType;
  status: OperationStatus;
  idempotencyKey?: string;
  requestHash: string;
  requestedStage?: AnyStage;
  source: SourceType;
  actorId?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  errorCode?: string;
  errorMessage?: string;
};

export type ActorContext = {
  requestId: string;
  tenantId: string;
  actorId: string;
  source: SourceType;
};

export type CreateDeploymentInput = {
  customerId: string;
  tenantId: string;
  projectName?: string;
  domain: string;
  packageCode: string;
  addOns?: string[];
  source: SourceType;
  createdBy?: string;
  triggeredBy?: string;
  idempotencyKey?: string;
};

export type NormalizedCreateDeploymentInput = {
  customerId: string;
  tenantId: string;
  projectName?: string;
  domain: string;
  rootDomain: string;
  packageCode: string;
  addOns: string[];
  source: SourceType;
  createdBy?: string;
  triggeredBy?: string;
  idempotencyKey?: string;
};