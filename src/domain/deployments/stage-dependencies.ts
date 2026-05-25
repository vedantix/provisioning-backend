export type DomainCheckResult = {
  domain: string;
  rootDomain: string;
  hostedZoneId: string;
  hostedZoneName?: string;
  hostedZoneCreated?: boolean;
  expectedNameServers?: string[];
  actualNameServers?: string[];
  domainRegistration?: {
    enabled?: boolean;
    availability?: string;
    submitted?: boolean;
    operationId?: string;
    operationStatus?: string;
    operationMessage?: string;
    errorMessage?: string;
  };
};

export type GitHubProvisionResult = {
  repoName: string;
};

export type S3BucketResult = {
  bucketName: string;
  bucketRegionalDomainName: string;
};

export type AcmRequestResult = {
  certificateArn: string;
};

export type AcmValidationRecord = {
  name: string;
  type: string;
  value: string;
  fqdn?: string;
};

export type AcmValidationRecordsResult = {
  validationRecords: AcmValidationRecord[];
  validationRecordFqdns: string[];
};

export type AcmWaitResult = {
  certificateArn: string;
  certificateStatus: string;
};

export type CloudFrontResult = {
  distributionId: string;
  domainName: string;
  arn?: string;
  oacId?: string;
};

export type Route53AliasResult = {
  aliasRecords: string[];
};

export type GoogleAnalyticsStageResult = {
  propertyId?: string;
  dataStreamId?: string;
  measurementId?: string;
  skipped?: boolean;
  reason?: string;
};

export type SearchConsoleStageResult = {
  propertyId?: string;
  verified: boolean;
  verificationRecordName?: string;
  skipped?: boolean;
  reason?: string;
};

export type ClarityStageResult = {
  projectId?: string;
  skipped?: boolean;
  trackingEnvironment: Record<string, string>;
};

export type GitHubDispatchResult = {
  workflowRunId: string;
};

export type SqsResult = {
  messageId?: string;
  queueType: string;
};

export interface StageDependencies {
  domainCheck(input: {
    domain: string;
  }): Promise<DomainCheckResult>;

  githubProvision(input: {
    customerId: string;
    domain: string;
    projectName?: string;
    packageCode: string;
    addOns: string[];
  }): Promise<GitHubProvisionResult>;

  s3Bucket(input: {
    domain: string;
  }): Promise<S3BucketResult>;

  acmRequest(input: {
    domain: string;
  }): Promise<AcmRequestResult>;

  acmValidationRecords(input: {
    certificateArn: string;
    hostedZoneId: string;
  }): Promise<AcmValidationRecordsResult>;

  acmDnsPropagation(input: {
    records: AcmValidationRecord[];
  }): Promise<void>;

  acmWait(input: {
    certificateArn: string;
  }): Promise<AcmWaitResult>;

  cloudFront(input: {
    domain: string;
    bucketName: string;
    bucketRegionalDomainName: string;
    certificateArn: string;
  }): Promise<CloudFrontResult>;

  enableCloudFront(input: {
    distributionId: string;
  }): Promise<CloudFrontResult>;

  route53Alias(input: {
    domain: string;
    rootDomain: string;
    hostedZoneId: string;
    cloudFrontDomainName: string;
  }): Promise<Route53AliasResult>;

  googleAnalytics(input: {
    tenantId: string;
    customerId: string;
    deploymentId: string;
    domain: string;
    displayName?: string;
  }): Promise<GoogleAnalyticsStageResult>;

  searchConsole(input: {
    tenantId: string;
    customerId: string;
    deploymentId: string;
    domain: string;
    displayName?: string;
    hostedZoneId: string;
  }): Promise<SearchConsoleStageResult>;

  clarity(input: {
    tenantId: string;
    customerId: string;
    deploymentId: string;
    domain: string;
    displayName?: string;
  }): Promise<ClarityStageResult>;

  githubDispatch(input: {
    repoName: string;
    domain: string;
    bucketName: string;
    cloudFrontDistributionId: string;
    trackingEnvironment?: Record<string, string>;
  }): Promise<GitHubDispatchResult>;

  dynamoDbSync(input: {
    deploymentId: string;
  }): Promise<void>;

  sqs(input: {
    deploymentId: string;
    customerId: string;
    domain: string;
  }): Promise<SqsResult>;
}
