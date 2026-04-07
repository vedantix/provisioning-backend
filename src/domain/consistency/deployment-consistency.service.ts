import {
  CloudFrontClient,
  GetDistributionCommand,
} from '@aws-sdk/client-cloudfront';
import {
  DescribeCertificateCommand,
  ACMClient,
} from '@aws-sdk/client-acm';
import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import {
  ListResourceRecordSetsCommand,
  Route53Client,
} from '@aws-sdk/client-route-53';
import { DeploymentsRepository } from '../../repositories/deployments.repository';
import type { DeploymentRecord } from '../deployments/types';

export type ConsistencyCheckItem = {
  resource: 'S3_BUCKET' | 'ACM_CERTIFICATE' | 'CLOUDFRONT' | 'ROUTE53_ALIAS';
  ok: boolean;
  reason?: string;
  details?: Record<string, unknown>;
};

export type DeploymentConsistencyResult = {
  deploymentId: string;
  ok: boolean;
  checks: ConsistencyCheckItem[];
};

const s3 = new S3Client({});
const cloudFront = new CloudFrontClient({});
const route53 = new Route53Client({});
const acm = new ACMClient({
  region: process.env.AWS_ACM_REGION || 'us-east-1',
});

export class DeploymentConsistencyService {
  constructor(
    private readonly deploymentsRepository = new DeploymentsRepository(),
  ) {}

  async assertDeploymentState(
    deploymentId: string,
  ): Promise<DeploymentConsistencyResult> {
    const deployment = await this.deploymentsRepository.getById(deploymentId);

    if (!deployment) {
      throw new Error('Deployment not found');
    }

    const result = await this.checkDeploymentState(deployment);

    if (!result.ok) {
      throw new Error(
        `Deployment consistency check failed for ${deploymentId}: ${result.checks
          .filter((check) => !check.ok)
          .map((check) => `${check.resource}:${check.reason ?? 'UNKNOWN'}`)
          .join(', ')}`,
      );
    }

    return result;
  }

  async checkDeploymentState(
    deployment: DeploymentRecord,
  ): Promise<DeploymentConsistencyResult> {
    const checks: ConsistencyCheckItem[] = [];

    if (deployment.status === 'DELETED') {
      checks.push(await this.checkBucketDeleted(deployment));
      checks.push(await this.checkCertificateDeleted(deployment));
      checks.push(await this.checkCloudFrontDeleted(deployment));
      checks.push(await this.checkRoute53AliasDeleted(deployment));
    } else {
      checks.push(await this.checkBucket(deployment));
      checks.push(await this.checkCertificate(deployment));
      checks.push(await this.checkCloudFront(deployment));
      checks.push(await this.checkRoute53Alias(deployment));
    }

    return {
      deploymentId: deployment.deploymentId,
      ok: checks.every((check) => check.ok),
      checks,
    };
  }

  private async checkBucket(
    deployment: DeploymentRecord,
  ): Promise<ConsistencyCheckItem> {
    const bucketName = deployment.managedResources.bucketName;
    if (!bucketName) {
      return {
        resource: 'S3_BUCKET',
        ok: false,
        reason: 'MISSING_BUCKET_NAME',
      };
    }

    try {
      await s3.send(new HeadBucketCommand({ Bucket: bucketName }));
      return {
        resource: 'S3_BUCKET',
        ok: true,
        details: { bucketName },
      };
    } catch (error) {
      return {
        resource: 'S3_BUCKET',
        ok: false,
        reason: error instanceof Error ? error.message : 'HEAD_BUCKET_FAILED',
        details: { bucketName },
      };
    }
  }

  private async checkBucketDeleted(
    deployment: DeploymentRecord,
  ): Promise<ConsistencyCheckItem> {
    const bucketName = deployment.managedResources.bucketName;
    if (!bucketName) {
      return {
        resource: 'S3_BUCKET',
        ok: true,
        details: { bucketName: null },
      };
    }

    try {
      await s3.send(new HeadBucketCommand({ Bucket: bucketName }));
      return {
        resource: 'S3_BUCKET',
        ok: false,
        reason: 'BUCKET_STILL_EXISTS',
        details: { bucketName },
      };
    } catch {
      return {
        resource: 'S3_BUCKET',
        ok: true,
        details: { bucketName },
      };
    }
  }

  private async checkCertificate(
    deployment: DeploymentRecord,
  ): Promise<ConsistencyCheckItem> {
    const certificateArn = deployment.managedResources.certificateArn;
    if (!certificateArn) {
      return {
        resource: 'ACM_CERTIFICATE',
        ok: false,
        reason: 'MISSING_CERTIFICATE_ARN',
      };
    }

    try {
      const result = await acm.send(
        new DescribeCertificateCommand({
          CertificateArn: certificateArn,
        }),
      );

      const status = result.Certificate?.Status;

      return {
        resource: 'ACM_CERTIFICATE',
        ok: status === 'ISSUED',
        reason: status === 'ISSUED' ? undefined : `CERT_STATUS_${status}`,
        details: {
          certificateArn,
          status,
        },
      };
    } catch (error) {
      return {
        resource: 'ACM_CERTIFICATE',
        ok: false,
        reason:
          error instanceof Error
            ? error.message
            : 'DESCRIBE_CERTIFICATE_FAILED',
        details: { certificateArn },
      };
    }
  }

  private async checkCertificateDeleted(
    deployment: DeploymentRecord,
  ): Promise<ConsistencyCheckItem> {
    const certificateArn = deployment.managedResources.certificateArn;
    if (!certificateArn) {
      return {
        resource: 'ACM_CERTIFICATE',
        ok: true,
        details: { certificateArn: null },
      };
    }

    try {
      await acm.send(
        new DescribeCertificateCommand({
          CertificateArn: certificateArn,
        }),
      );

      return {
        resource: 'ACM_CERTIFICATE',
        ok: false,
        reason: 'CERTIFICATE_STILL_EXISTS',
        details: { certificateArn },
      };
    } catch {
      return {
        resource: 'ACM_CERTIFICATE',
        ok: true,
        details: { certificateArn },
      };
    }
  }

  private async checkCloudFront(
    deployment: DeploymentRecord,
  ): Promise<ConsistencyCheckItem> {
    const distributionId =
      deployment.managedResources.cloudFrontDistributionId;

    if (!distributionId) {
      return {
        resource: 'CLOUDFRONT',
        ok: false,
        reason: 'MISSING_DISTRIBUTION_ID',
      };
    }

    try {
      const result = await cloudFront.send(
        new GetDistributionCommand({
          Id: distributionId,
        }),
      );

      const distribution = result.Distribution;
      const status = distribution?.Status;
      const aliases =
        distribution?.DistributionConfig?.Aliases?.Items ?? [];

      return {
        resource: 'CLOUDFRONT',
        ok: status === 'Deployed' && aliases.includes(deployment.domain),
        reason:
          status !== 'Deployed'
            ? `DISTRIBUTION_STATUS_${status}`
            : !aliases.includes(deployment.domain)
              ? 'DOMAIN_ALIAS_MISSING'
              : undefined,
        details: {
          distributionId,
          status,
          aliases,
        },
      };
    } catch (error) {
      return {
        resource: 'CLOUDFRONT',
        ok: false,
        reason:
          error instanceof Error ? error.message : 'GET_DISTRIBUTION_FAILED',
        details: { distributionId },
      };
    }
  }

  private async checkCloudFrontDeleted(
    deployment: DeploymentRecord,
  ): Promise<ConsistencyCheckItem> {
    const distributionId =
      deployment.managedResources.cloudFrontDistributionId;

    if (!distributionId) {
      return {
        resource: 'CLOUDFRONT',
        ok: true,
        details: { distributionId: null },
      };
    }

    try {
      await cloudFront.send(
        new GetDistributionCommand({
          Id: distributionId,
        }),
      );

      return {
        resource: 'CLOUDFRONT',
        ok: false,
        reason: 'DISTRIBUTION_STILL_EXISTS',
        details: { distributionId },
      };
    } catch {
      return {
        resource: 'CLOUDFRONT',
        ok: true,
        details: { distributionId },
      };
    }
  }

  private async checkRoute53Alias(
    deployment: DeploymentRecord,
  ): Promise<ConsistencyCheckItem> {
    const hostedZoneId =
      deployment.managedResources.hostedZoneId ||
      process.env.AWS_ROUTE53_HOSTED_ZONE_ID;

    if (!hostedZoneId) {
      return {
        resource: 'ROUTE53_ALIAS',
        ok: false,
        reason: 'MISSING_HOSTED_ZONE_ID',
      };
    }

    try {
      const result = await route53.send(
        new ListResourceRecordSetsCommand({
          HostedZoneId: hostedZoneId,
          StartRecordName: deployment.domain,
          StartRecordType: 'A',
          MaxItems: 5,
        }),
      );

      const found = (result.ResourceRecordSets ?? []).find(
        (record) =>
          record.Name?.replace(/\.$/, '') === deployment.domain &&
          record.Type === 'A',
      );

      return {
        resource: 'ROUTE53_ALIAS',
        ok: Boolean(found),
        reason: found ? undefined : 'ALIAS_RECORD_NOT_FOUND',
        details: {
          hostedZoneId,
          domain: deployment.domain,
          found: Boolean(found),
        },
      };
    } catch (error) {
      return {
        resource: 'ROUTE53_ALIAS',
        ok: false,
        reason:
          error instanceof Error
            ? error.message
            : 'LIST_RECORD_SETS_FAILED',
        details: {
          hostedZoneId,
          domain: deployment.domain,
        },
      };
    }
  }

  private async checkRoute53AliasDeleted(
    deployment: DeploymentRecord,
  ): Promise<ConsistencyCheckItem> {
    const hostedZoneId =
      deployment.managedResources.hostedZoneId ||
      process.env.AWS_ROUTE53_HOSTED_ZONE_ID;

    if (!hostedZoneId) {
      return {
        resource: 'ROUTE53_ALIAS',
        ok: true,
        details: { hostedZoneId: null },
      };
    }

    try {
      const result = await route53.send(
        new ListResourceRecordSetsCommand({
          HostedZoneId: hostedZoneId,
          StartRecordName: deployment.domain,
          StartRecordType: 'A',
          MaxItems: 5,
        }),
      );

      const found = (result.ResourceRecordSets ?? []).find(
        (record) =>
          record.Name?.replace(/\.$/, '') === deployment.domain &&
          record.Type === 'A',
      );

      return {
        resource: 'ROUTE53_ALIAS',
        ok: !found,
        reason: found ? 'ALIAS_RECORD_STILL_EXISTS' : undefined,
        details: {
          hostedZoneId,
          domain: deployment.domain,
          found: Boolean(found),
        },
      };
    } catch (error) {
      return {
        resource: 'ROUTE53_ALIAS',
        ok: false,
        reason:
          error instanceof Error
            ? error.message
            : 'LIST_RECORD_SETS_FAILED',
        details: {
          hostedZoneId,
          domain: deployment.domain,
        },
      };
    }
  }
}