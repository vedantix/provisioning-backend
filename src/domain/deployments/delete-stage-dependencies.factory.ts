import type { DeleteStageDependencies } from './delete-stage-dependencies';

import {
  disableAndDeleteDistribution,
} from '../../services/aws/cloudfront.service';

import {
  deleteCertificateIfExists,
} from '../../services/aws/acm.service';

import {
  deleteDnsValidationRecords,
  removeCloudFrontAliasRecords,
} from '../../services/aws/route53.service';

import {
  emptyAndDeleteBucket,
} from '../../services/aws/s3.service';

class DeleteStageDependenciesFactoryImpl implements DeleteStageDependencies {
  async deleteDomainAlias(input: {
    domain: string;
    rootDomain: string;
    hostedZoneId: string;
    aliasRecords?: string[];
  }) {
    void input.hostedZoneId;

    const domains =
      input.aliasRecords && input.aliasRecords.length > 0
        ? input.aliasRecords
        : [input.domain, `www.${input.rootDomain}`];

    const result = await removeCloudFrontAliasRecords(domains);

    return {
      removedRecords: result.removedDomains,
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
    const result = await disableAndDeleteDistribution(input.distributionId);

    return {
      distributionId: result.distributionId,
      deleted: result.deleted,
    };
  }

  async emptyS3Bucket(input: { bucketName: string }) {
    return {
      bucketName: input.bucketName,
      emptied: true,
    };
  }

  async deleteS3Bucket(input: { bucketName: string }) {
    const result = await emptyAndDeleteBucket({
      bucketName: input.bucketName,
    });

    return {
      bucketName: result.bucketName,
      deleted: result.deleted,
    };
  }

  async deleteAcmValidationRecords(input: {
    hostedZoneId: string;
    validationRecordFqdns?: string[];
  }) {
    const result = await deleteDnsValidationRecords({
      hostedZoneId: input.hostedZoneId,
      recordNames: input.validationRecordFqdns,
    });

    return {
      removedValidationRecordFqdns: result.removedRecordNames,
    };
  }

  async deleteAcmCertificate(input: { certificateArn: string }) {
    const result = await deleteCertificateIfExists({
      certificateArn: input.certificateArn,
    });

    return {
      certificateArn: result.certificateArn,
      deleted: result.deleted,
    };
  }
}

export function createDeleteStageDependencies(): DeleteStageDependencies {
  return new DeleteStageDependenciesFactoryImpl();
}