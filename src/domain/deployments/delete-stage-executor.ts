import {
    CloudFrontClient,
    DeleteDistributionCommand,
    GetDistributionCommand,
    GetDistributionConfigCommand,
    UpdateDistributionCommand,
  } from '@aws-sdk/client-cloudfront';
  import {
    ACMClient,
    DeleteCertificateCommand,
    DescribeCertificateCommand,
    ListTagsForCertificateCommand,
  } from '@aws-sdk/client-acm';
  import {
    DeleteObjectsCommand,
    DeleteBucketCommand,
    ListObjectsV2Command,
    GetBucketTaggingCommand,
    S3Client,
  } from '@aws-sdk/client-s3';
  import {
    ChangeResourceRecordSetsCommand,
    ListResourceRecordSetsCommand,
    Route53Client,
  } from '@aws-sdk/client-route-53';
  
  import type { DeleteStage, DeploymentRecord } from './types';
  import { ResourceOwnershipService } from './resource-ownership.service';
  
  export type DeleteStageExecutionResult = {
    stage: DeleteStage;
    skippedBecauseMissing?: boolean;
    details?: Record<string, unknown>;
  };
  
  const s3 = new S3Client({});
  const acm = new ACMClient({
    region: process.env.AWS_ACM_REGION || 'us-east-1',
  });
  const cloudFront = new CloudFrontClient({});
  const route53 = new Route53Client({});
  
  export class DeleteStageExecutor {
    constructor(
      private readonly ownershipService = new ResourceOwnershipService(),
    ) {}
  
    async execute(
      stage: DeleteStage,
      deployment: DeploymentRecord,
    ): Promise<DeleteStageExecutionResult> {
      switch (stage) {
        case 'DELETE_DOMAIN_ALIAS':
          return this.deleteDomainAlias(deployment);
  
        case 'DISABLE_CLOUDFRONT':
          return this.disableCloudFront(deployment);
  
        case 'WAIT_CLOUDFRONT_DISABLED':
          return this.waitCloudFrontDisabled(deployment);
  
        case 'DELETE_CLOUDFRONT':
          return this.deleteCloudFront(deployment);
  
        case 'EMPTY_S3_BUCKET':
          return this.emptyBucket(deployment);
  
        case 'DELETE_S3_BUCKET':
          return this.deleteBucket(deployment);
  
        case 'DELETE_ACM_VALIDATION_RECORDS':
          return this.deleteAcmValidationRecords(deployment);
  
        case 'DELETE_ACM_CERTIFICATE':
          return this.deleteCertificate(deployment);
  
        case 'FINALIZE_DELETE':
          return this.finalizeDelete(deployment);
  
        default: {
          const exhaustiveCheck: never = stage;
          throw new Error(`Unsupported delete stage: ${exhaustiveCheck}`);
        }
      }
    }
  
    private async deleteDomainAlias(
      deployment: DeploymentRecord,
    ): Promise<DeleteStageExecutionResult> {
      const hostedZoneId =
        deployment.managedResources.hostedZoneId ||
        process.env.AWS_ROUTE53_HOSTED_ZONE_ID;
  
      if (!hostedZoneId) {
        return {
          stage: 'DELETE_DOMAIN_ALIAS',
          skippedBecauseMissing: true,
          details: { reason: 'Missing hostedZoneId' },
        };
      }
  
      const listResult = await route53.send(
        new ListResourceRecordSetsCommand({
          HostedZoneId: hostedZoneId,
          StartRecordName: deployment.domain,
          StartRecordType: 'A',
          MaxItems: 10,
        }),
      );
  
      const targetRecord = (listResult.ResourceRecordSets ?? []).find(
        (record) =>
          record.Name?.replace(/\.$/, '') === deployment.domain &&
          record.Type === 'A',
      );
  
      if (!targetRecord) {
        return {
          stage: 'DELETE_DOMAIN_ALIAS',
          skippedBecauseMissing: true,
          details: {
            hostedZoneId,
            domain: deployment.domain,
            reason: 'Alias record not found',
          },
        };
      }
  
      this.ownershipService.assertRoute53Ownership(deployment, targetRecord.Name);
  
      await route53.send(
        new ChangeResourceRecordSetsCommand({
          HostedZoneId: hostedZoneId,
          ChangeBatch: {
            Changes: [
              {
                Action: 'DELETE',
                ResourceRecordSet: targetRecord,
              },
            ],
          },
        }),
      );
  
      return {
        stage: 'DELETE_DOMAIN_ALIAS',
        details: {
          hostedZoneId,
          domain: deployment.domain,
        },
      };
    }
  
    private async disableCloudFront(
      deployment: DeploymentRecord,
    ): Promise<DeleteStageExecutionResult> {
      const distributionId =
        deployment.managedResources.cloudFrontDistributionId;
  
      if (!distributionId) {
        return {
          stage: 'DISABLE_CLOUDFRONT',
          skippedBecauseMissing: true,
          details: { reason: 'Missing cloudFrontDistributionId' },
        };
      }
  
      const distribution = await this.getDistributionIfExists(distributionId);
  
      if (!distribution) {
        return {
          stage: 'DISABLE_CLOUDFRONT',
          skippedBecauseMissing: true,
          details: {
            distributionId,
            reason: 'Distribution not found',
          },
        };
      }
  
      const tagMap = this.extractCloudFrontOwnershipFromComment(
        distribution.DistributionConfig?.Comment,
      );
  
      this.ownershipService.assertCloudFrontOwnership(deployment, tagMap);
  
      if (distribution.DistributionConfig?.Enabled === false) {
        return {
          stage: 'DISABLE_CLOUDFRONT',
          details: {
            distributionId,
            alreadyDisabled: true,
          },
        };
      }
  
      const configResult = await cloudFront.send(
        new GetDistributionConfigCommand({
          Id: distributionId,
        }),
      );
  
      if (!configResult.DistributionConfig || !configResult.ETag) {
        throw new Error(
          `Unable to load CloudFront config for distribution ${distributionId}`,
        );
      }
  
      await cloudFront.send(
        new UpdateDistributionCommand({
          Id: distributionId,
          IfMatch: configResult.ETag,
          DistributionConfig: {
            ...configResult.DistributionConfig,
            Enabled: false,
          },
        }),
      );
  
      return {
        stage: 'DISABLE_CLOUDFRONT',
        details: {
          distributionId,
          disabled: true,
        },
      };
    }
  
    private async waitCloudFrontDisabled(
      deployment: DeploymentRecord,
    ): Promise<DeleteStageExecutionResult> {
      const distributionId =
        deployment.managedResources.cloudFrontDistributionId;
  
      if (!distributionId) {
        return {
          stage: 'WAIT_CLOUDFRONT_DISABLED',
          skippedBecauseMissing: true,
          details: { reason: 'Missing cloudFrontDistributionId' },
        };
      }
  
      const distribution = await this.getDistributionIfExists(distributionId);
  
      if (!distribution) {
        return {
          stage: 'WAIT_CLOUDFRONT_DISABLED',
          skippedBecauseMissing: true,
          details: {
            distributionId,
            reason: 'Distribution not found',
          },
        };
      }
  
      const enabled = distribution.DistributionConfig?.Enabled;
      const status = distribution.Status;
  
      if (enabled === false && status === 'Deployed') {
        return {
          stage: 'WAIT_CLOUDFRONT_DISABLED',
          details: {
            distributionId,
            readyForDelete: true,
            status,
          },
        };
      }
  
      throw new Error(
        `CloudFront distribution ${distributionId} is not yet disabled and deployed (enabled=${String(
          enabled,
        )}, status=${status ?? 'UNKNOWN'})`,
      );
    }
  
    private async deleteCloudFront(
      deployment: DeploymentRecord,
    ): Promise<DeleteStageExecutionResult> {
      const distributionId =
        deployment.managedResources.cloudFrontDistributionId;
  
      if (!distributionId) {
        return {
          stage: 'DELETE_CLOUDFRONT',
          skippedBecauseMissing: true,
          details: { reason: 'Missing cloudFrontDistributionId' },
        };
      }
  
      const configResult = await this.getDistributionConfigIfExists(distributionId);
  
      if (!configResult) {
        return {
          stage: 'DELETE_CLOUDFRONT',
          skippedBecauseMissing: true,
          details: {
            distributionId,
            reason: 'Distribution config not found',
          },
        };
      }
  
      const tagMap = this.extractCloudFrontOwnershipFromComment(
        configResult.DistributionConfig?.Comment,
      );
  
      this.ownershipService.assertCloudFrontOwnership(deployment, tagMap);
  
      if (configResult.DistributionConfig?.Enabled !== false) {
        throw new Error(
          `CloudFront distribution ${distributionId} must be disabled before deletion`,
        );
      }
  
      await cloudFront.send(
        new DeleteDistributionCommand({
          Id: distributionId,
          IfMatch: configResult.ETag,
        }),
      );
  
      return {
        stage: 'DELETE_CLOUDFRONT',
        details: {
          distributionId,
          deleted: true,
        },
      };
    }
  
    private async emptyBucket(
      deployment: DeploymentRecord,
    ): Promise<DeleteStageExecutionResult> {
      const bucketName = deployment.managedResources.bucketName;
  
      if (!bucketName) {
        return {
          stage: 'EMPTY_S3_BUCKET',
          skippedBecauseMissing: true,
          details: { reason: 'Missing bucketName' },
        };
      }
  
      const tags = await this.getBucketTagsIfExists(bucketName);
  
      if (!tags) {
        return {
          stage: 'EMPTY_S3_BUCKET',
          skippedBecauseMissing: true,
          details: {
            bucketName,
            reason: 'Bucket not found or no tags available',
          },
        };
      }
  
      this.ownershipService.assertS3Ownership(deployment, tags);
  
      let deletedObjects = 0;
      let continuationToken: string | undefined;
  
      do {
        const page = await s3.send(
          new ListObjectsV2Command({
            Bucket: bucketName,
            ContinuationToken: continuationToken,
          }),
        );
  
        const objects = (page.Contents ?? [])
          .map((item) => item.Key)
          .filter((key): key is string => Boolean(key));
  
        if (objects.length > 0) {
          await s3.send(
            new DeleteObjectsCommand({
              Bucket: bucketName,
              Delete: {
                Objects: objects.map((key) => ({ Key: key })),
                Quiet: true,
              },
            }),
          );
  
          deletedObjects += objects.length;
        }
  
        continuationToken = page.IsTruncated
          ? page.NextContinuationToken
          : undefined;
      } while (continuationToken);
  
      return {
        stage: 'EMPTY_S3_BUCKET',
        details: {
          bucketName,
          deletedObjects,
        },
      };
    }
  
    private async deleteBucket(
      deployment: DeploymentRecord,
    ): Promise<DeleteStageExecutionResult> {
      const bucketName = deployment.managedResources.bucketName;
  
      if (!bucketName) {
        return {
          stage: 'DELETE_S3_BUCKET',
          skippedBecauseMissing: true,
          details: { reason: 'Missing bucketName' },
        };
      }
  
      const tags = await this.getBucketTagsIfExists(bucketName);
  
      if (!tags) {
        return {
          stage: 'DELETE_S3_BUCKET',
          skippedBecauseMissing: true,
          details: {
            bucketName,
            reason: 'Bucket not found or no tags available',
          },
        };
      }
  
      this.ownershipService.assertS3Ownership(deployment, tags);
  
      await s3.send(
        new DeleteBucketCommand({
          Bucket: bucketName,
        }),
      );
  
      return {
        stage: 'DELETE_S3_BUCKET',
        details: {
          bucketName,
          deleted: true,
        },
      };
    }
  
    private async deleteAcmValidationRecords(
      deployment: DeploymentRecord,
    ): Promise<DeleteStageExecutionResult> {
      const hostedZoneId =
        deployment.managedResources.hostedZoneId ||
        process.env.AWS_ROUTE53_HOSTED_ZONE_ID;
  
      const recordNames = deployment.managedResources.validationRecordFqdns ?? [];
  
      if (!hostedZoneId || recordNames.length === 0) {
        return {
          stage: 'DELETE_ACM_VALIDATION_RECORDS',
          skippedBecauseMissing: true,
          details: {
            hostedZoneId,
            count: recordNames.length,
            reason: 'Missing hostedZoneId or validationRecordFqdns',
          },
        };
      }
  
      const deleted: string[] = [];
      const skipped: string[] = [];
  
      for (const recordName of recordNames) {
        const listResult = await route53.send(
          new ListResourceRecordSetsCommand({
            HostedZoneId: hostedZoneId,
            StartRecordName: recordName,
            StartRecordType: 'CNAME',
            MaxItems: 5,
          }),
        );
  
        const targetRecord = (listResult.ResourceRecordSets ?? []).find(
          (record) =>
            record.Name?.replace(/\.$/, '') === recordName.replace(/\.$/, '') &&
            record.Type === 'CNAME',
        );
  
        if (!targetRecord) {
          skipped.push(recordName);
          continue;
        }
  
        await route53.send(
          new ChangeResourceRecordSetsCommand({
            HostedZoneId: hostedZoneId,
            ChangeBatch: {
              Changes: [
                {
                  Action: 'DELETE',
                  ResourceRecordSet: targetRecord,
                },
              ],
            },
          }),
        );
  
        deleted.push(recordName);
      }
  
      return {
        stage: 'DELETE_ACM_VALIDATION_RECORDS',
        details: {
          hostedZoneId,
          deleted,
          skipped,
        },
      };
    }
  
    private async deleteCertificate(
      deployment: DeploymentRecord,
    ): Promise<DeleteStageExecutionResult> {
      const certificateArn = deployment.managedResources.certificateArn;
  
      if (!certificateArn) {
        return {
          stage: 'DELETE_ACM_CERTIFICATE',
          skippedBecauseMissing: true,
          details: { reason: 'Missing certificateArn' },
        };
      }
  
      const describeResult = await this.describeCertificateIfExists(certificateArn);
  
      if (!describeResult) {
        return {
          stage: 'DELETE_ACM_CERTIFICATE',
          skippedBecauseMissing: true,
          details: {
            certificateArn,
            reason: 'Certificate not found',
          },
        };
      }
  
      const tagResult = await acm.send(
        new ListTagsForCertificateCommand({
          CertificateArn: certificateArn,
        }),
      );
  
      const tagMap = Object.fromEntries(
        (tagResult.Tags ?? [])
          .filter((tag) => tag.Key)
          .map((tag) => [tag.Key as string, tag.Value]),
      );
  
      this.ownershipService.assertCertificateOwnership(deployment, tagMap);
  
      await acm.send(
        new DeleteCertificateCommand({
          CertificateArn: certificateArn,
        }),
      );
  
      return {
        stage: 'DELETE_ACM_CERTIFICATE',
        details: {
          certificateArn,
          deleted: true,
        },
      };
    }
  
    private async finalizeDelete(
      deployment: DeploymentRecord,
    ): Promise<DeleteStageExecutionResult> {
      return {
        stage: 'FINALIZE_DELETE',
        details: {
          deploymentId: deployment.deploymentId,
          finalized: true,
        },
      };
    }
  
    private async getBucketTagsIfExists(
      bucketName: string,
    ): Promise<Record<string, string> | null> {
      try {
        const result = await s3.send(
          new GetBucketTaggingCommand({
            Bucket: bucketName,
          }),
        );
  
        return Object.fromEntries(
          (result.TagSet ?? []).map((tag) => [tag.Key, tag.Value]),
        );
      } catch {
        return null;
      }
    }
  
    private async getDistributionIfExists(distributionId: string) {
      try {
        const result = await cloudFront.send(
          new GetDistributionCommand({
            Id: distributionId,
          }),
        );
  
        return result.Distribution;
      } catch {
        return null;
      }
    }
  
    private async getDistributionConfigIfExists(distributionId: string) {
      try {
        return await cloudFront.send(
          new GetDistributionConfigCommand({
            Id: distributionId,
          }),
        );
      } catch {
        return null;
      }
    }
  
    private async describeCertificateIfExists(certificateArn: string) {
      try {
        return await acm.send(
          new DescribeCertificateCommand({
            CertificateArn: certificateArn,
          }),
        );
      } catch {
        return null;
      }
    }
  
    private extractCloudFrontOwnershipFromComment(
      comment?: string,
    ): Record<string, string> | undefined {
      if (!comment) {
        return undefined;
      }
  
      try {
        if (comment.startsWith('{') && comment.endsWith('}')) {
          const parsed = JSON.parse(comment) as Record<string, string>;
          return parsed;
        }
      } catch {
        return undefined;
      }
  
      return undefined;
    }
  }