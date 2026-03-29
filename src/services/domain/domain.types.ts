export type DomainOwnershipCheckResult = {
    customerId: string;
    deploymentId: string;
    bucketName: string;
    cloudfrontDistributionId: string;
    cloudfrontDomainName?: string;
    certificateArn?: string;
    domains: string[];
  };
  
  export type CheckDomainRequest = {
    domain: string;
  };
  
  export type AddDomainRequest = {
    customerId: string;
    deploymentId: string;
    domain: string;
  };
  
  export type AddDomainStage =
    | 'DOMAIN_CHECK'
    | 'DEPLOYMENT_LOOKUP'
    | 'ACM_REQUEST'
    | 'ACM_VALIDATION_RECORDS'
    | 'ACM_WAIT'
    | 'CLOUDFRONT_UPDATE'
    | 'ROUTE53_ALIAS'
    | 'DYNAMODB';
  
  export type AddDomainStageStatus =
    | 'PENDING'
    | 'IN_PROGRESS'
    | 'SUCCEEDED'
    | 'FAILED';
  
  export type AddDomainStageRecord = {
    stage: AddDomainStage;
    status: AddDomainStageStatus;
    startedAt: string;
    completedAt?: string;
    error?: string;
    details?: unknown;
  };
  
  export type AddDomainFailure = {
    success: false;
    stage: AddDomainStage;
    error: string;
    details?: unknown;
    stages: AddDomainStageRecord[];
  };
  
  export type AddDomainSuccess = {
    success: true;
    deploymentId: string;
    domain: string;
    allDomains: string[];
    certificateArn: string;
    distributionId: string;
    cloudFrontDomainName?: string;
    stages: AddDomainStageRecord[];
  };
  
  export type AddDomainResult = AddDomainSuccess | AddDomainFailure;