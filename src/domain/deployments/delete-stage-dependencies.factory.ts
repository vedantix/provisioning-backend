import type { DeleteStageDependencies } from './delete-stage-dependencies';

class DeleteStageDependenciesFactoryImpl implements DeleteStageDependencies {
  async deleteDomainAlias(input: {
    domain: string;
    rootDomain: string;
    hostedZoneId: string;
    aliasRecords?: string[];
  }) {
    void input;

    return {
      removedRecords: input.aliasRecords ?? [input.domain, `www.${input.rootDomain}`],
    };
  }

  async disableCloudFront(input: { distributionId: string }) {
    return {
      distributionId: input.distributionId,
      disabled: true,
    };
  }

  async waitCloudFrontDisabled(input: { distributionId: string }) {
    return {
      distributionId: input.distributionId,
      status: 'DISABLED',
    };
  }

  async deleteCloudFront(input: { distributionId: string }) {
    return {
      distributionId: input.distributionId,
      deleted: true,
    };
  }

  async emptyS3Bucket(input: { bucketName: string }) {
    return {
      bucketName: input.bucketName,
      emptied: true,
    };
  }

  async deleteS3Bucket(input: { bucketName: string }) {
    return {
      bucketName: input.bucketName,
      deleted: true,
    };
  }

  async deleteAcmValidationRecords(input: {
    hostedZoneId: string;
    validationRecordFqdns?: string[];
  }) {
    void input;

    return {
      removedValidationRecordFqdns: input.validationRecordFqdns ?? [],
    };
  }

  async deleteAcmCertificate(input: { certificateArn: string }) {
    return {
      certificateArn: input.certificateArn,
      deleted: true,
    };
  }
}

export function createDeleteStageDependencies(): DeleteStageDependencies {
  return new DeleteStageDependenciesFactoryImpl();
}