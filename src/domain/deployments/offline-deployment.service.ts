import { DeploymentsRepository } from '../../repositories/deployments.repository';
import { CustomersRepository } from '../../modules/customers/repositories/customers.repository';
import type { DeploymentRecord } from './types';
import { disableDistribution } from '../../services/aws/cloudfront.service';
import { removeCloudFrontAliasRecords } from '../../services/aws/route53.service';
import { emptyBucketContents } from '../../services/aws/s3.service';

export type OfflineDeploymentResult = {
  deploymentId: string;
  customerId: string;
  status: 'OFFLINE';
  removedAliases: string[];
  cloudFront?: {
    distributionId: string;
    disabled: true;
    eTag?: string;
  };
  s3?: {
    bucketName: string;
    emptied: boolean;
  };
};

function domainsForAliases(deployment: DeploymentRecord): string[] {
  const existing = deployment.managedResources.route53AliasRecords ?? [];
  const fallback = [deployment.domain, `www.${deployment.rootDomain}`];
  return [...new Set([...existing, ...fallback].filter(Boolean))];
}

export class OfflineDeploymentService {
  constructor(
    private readonly deploymentsRepository = new DeploymentsRepository(),
    private readonly customersRepository = new CustomersRepository(),
  ) {}

  async takeOffline(params: {
    deploymentId: string;
    actorId: string;
  }): Promise<OfflineDeploymentResult> {
    const deployment = await this.deploymentsRepository.getById(
      params.deploymentId,
    );

    if (!deployment) {
      throw new Error('Deployment not found');
    }

    const removedAliases = await this.removeAliases(deployment);
    const cloudFront = await this.disableCloudFront(deployment);
    const s3 = await this.emptyBucket(deployment);
    const now = new Date().toISOString();

    await this.deploymentsRepository.markDeploymentOffline(
      deployment.deploymentId,
      now,
    );

    await this.customersRepository.markDeploymentOffline({
      customerId: deployment.customerId,
      updatedAt: now,
      updatedBy: params.actorId,
      deploymentId: deployment.deploymentId,
      liveDomain: deployment.domain,
    });

    return {
      deploymentId: deployment.deploymentId,
      customerId: deployment.customerId,
      status: 'OFFLINE',
      removedAliases,
      cloudFront,
      s3,
    };
  }

  private async removeAliases(deployment: DeploymentRecord): Promise<string[]> {
    const domains = domainsForAliases(deployment);
    if (!domains.length) {
      return [];
    }

    const result = await removeCloudFrontAliasRecords(domains);
    return result.removedDomains;
  }

  private async disableCloudFront(
    deployment: DeploymentRecord,
  ): Promise<OfflineDeploymentResult['cloudFront']> {
    const distributionId = deployment.managedResources.cloudFrontDistributionId;
    if (!distributionId) {
      return undefined;
    }

    return disableDistribution(distributionId);
  }

  private async emptyBucket(
    deployment: DeploymentRecord,
  ): Promise<OfflineDeploymentResult['s3']> {
    const bucketName = deployment.managedResources.bucketName;
    if (!bucketName) {
      return undefined;
    }

    const result = await emptyBucketContents({ bucketName });
    return {
      bucketName: result.bucketName,
      emptied: result.emptied,
    };
  }
}
