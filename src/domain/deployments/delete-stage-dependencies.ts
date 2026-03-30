export type DeleteDomainAliasResult = {
  removedRecords: string[];
};

export type DisableCloudFrontResult = {
  distributionId: string;
  disabled: boolean;
  eTag?: string;
};

export type WaitCloudFrontDisabledResult = {
  distributionId: string;
  status: string;
  eTag?: string;
};

export type DeleteCloudFrontResult = {
  distributionId: string;
  deleted: boolean;
};

export type EmptyS3BucketResult = {
  bucketName: string;
  emptied: boolean;
};

export type DeleteS3BucketResult = {
  bucketName: string;
  deleted: boolean;
};

export type DeleteAcmValidationRecordsResult = {
  removedValidationRecordFqdns: string[];
};

export type DeleteAcmCertificateResult = {
  certificateArn: string;
  deleted: boolean;
};

export interface DeleteStageDependencies {
  deleteDomainAlias(input: {
    domain: string;
    rootDomain: string;
    hostedZoneId: string;
    aliasRecords?: string[];
  }): Promise<DeleteDomainAliasResult>;

  disableCloudFront(input: {
    distributionId: string;
  }): Promise<DisableCloudFrontResult>;

  waitCloudFrontDisabled(input: {
    distributionId: string;
  }): Promise<WaitCloudFrontDisabledResult>;

  deleteCloudFront(input: {
    distributionId: string;
  }): Promise<DeleteCloudFrontResult>;

  emptyS3Bucket(input: {
    bucketName: string;
  }): Promise<EmptyS3BucketResult>;

  deleteS3Bucket(input: {
    bucketName: string;
  }): Promise<DeleteS3BucketResult>;

  deleteAcmValidationRecords(input: {
    hostedZoneId: string;
    validationRecordFqdns?: string[];
  }): Promise<DeleteAcmValidationRecordsResult>;

  deleteAcmCertificate(input: {
    certificateArn: string;
  }): Promise<DeleteAcmCertificateResult>;
}