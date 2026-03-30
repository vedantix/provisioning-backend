import type { DeploymentRecord } from './types';
import { DeploymentsRepository } from '../../repositories/deployments.repository';

type CleanupCandidate = {
  deploymentId: string;
  tenantId: string;
  customerId: string;
  domain: string;
  status: string;
  failureStage?: string;
  updatedAt: string;
  managedResources: {
    bucketName?: string;
    certificateArn?: string;
    cloudFrontDistributionId?: string;
    repoName?: string;
  };
};

export class CleanupCandidatesService {
  constructor(
    private readonly deploymentsRepository = new DeploymentsRepository(),
  ) {}

  async listCandidates(params?: {
    tenantId?: string;
    limit?: number;
  }): Promise<CleanupCandidate[]> {
    const limit = params?.limit ?? 50;
    const all = await this.deploymentsRepository.listCleanupCandidates({
      tenantId: params?.tenantId,
      limit,
    });

    return all.map((deployment) => this.toCleanupCandidate(deployment));
  }

  private toCleanupCandidate(deployment: DeploymentRecord): CleanupCandidate {
    return {
      deploymentId: deployment.deploymentId,
      tenantId: deployment.tenantId,
      customerId: deployment.customerId,
      domain: deployment.domain,
      status: deployment.status,
      failureStage: deployment.failureStage,
      updatedAt: deployment.updatedAt,
      managedResources: {
        bucketName: deployment.managedResources.bucketName,
        certificateArn: deployment.managedResources.certificateArn,
        cloudFrontDistributionId:
          deployment.managedResources.cloudFrontDistributionId,
        repoName: deployment.managedResources.repoName,
      },
    };
  }
}