export type DomainCheckResult = {
  domain: string;
  rootDomain: string;
  hostedZoneId: string;
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

  route53Alias(input: {
    domain: string;
    rootDomain: string;
    hostedZoneId: string;
    cloudFrontDomainName: string;
  }): Promise<Route53AliasResult>;

  githubDispatch(input: {
    repoName: string;
    domain: string;
    bucketName: string;
    cloudFrontDistributionId: string;
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