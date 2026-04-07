import type { DeploymentRecord } from './types';
import { ResourceOwnershipService } from './resource-ownership.service';
import { DeploymentsRepository } from '../../repositories/deployments.repository';

export type DeletePreflightResult = {
  ok: boolean;
  deploymentId: string;
  checks: Array<{
    name:
      | 'DEPLOYMENT_EXISTS'
      | 'NOT_ALREADY_DELETED'
      | 'HAS_DOMAIN'
      | 'HAS_MANAGED_RESOURCES'
      | 'OWNERSHIP_TOKEN_READY';
    ok: boolean;
    reason?: string;
  }>;
};

export class DeletePreflightService {
  constructor(
    private readonly deploymentsRepository = new DeploymentsRepository(),
    private readonly ownershipService = new ResourceOwnershipService(),
  ) {}

  async run(deploymentId: string): Promise<DeletePreflightResult> {
    const deployment = await this.deploymentsRepository.getById(deploymentId);

    if (!deployment) {
      return {
        ok: false,
        deploymentId,
        checks: [
          {
            name: 'DEPLOYMENT_EXISTS',
            ok: false,
            reason: 'Deployment not found',
          },
        ],
      };
    }

    return this.runForDeployment(deployment);
  }

  runForDeployment(deployment: DeploymentRecord): DeletePreflightResult {
    const checks: DeletePreflightResult['checks'] = [];

    checks.push({
      name: 'DEPLOYMENT_EXISTS',
      ok: true,
    });

    checks.push({
      name: 'NOT_ALREADY_DELETED',
      ok: deployment.status !== 'DELETED',
      reason:
        deployment.status === 'DELETED'
          ? 'Deployment is already marked as DELETED'
          : undefined,
    });

    checks.push({
      name: 'HAS_DOMAIN',
      ok: Boolean(deployment.domain && deployment.rootDomain),
      reason:
        !deployment.domain || !deployment.rootDomain
          ? 'Deployment is missing domain information'
          : undefined,
    });

    checks.push({
      name: 'HAS_MANAGED_RESOURCES',
      ok: this.hasAnyManagedResource(deployment),
      reason: this.hasAnyManagedResource(deployment)
        ? undefined
        : 'Deployment has no managed resources registered',
    });

    const resourcesWithOwnership =
      this.ownershipService.ensureManagedResourcesHaveOwnership(deployment);

    checks.push({
      name: 'OWNERSHIP_TOKEN_READY',
      ok: Boolean(resourcesWithOwnership.ownershipToken),
      reason: !resourcesWithOwnership.ownershipToken
        ? 'Ownership token could not be prepared'
        : undefined,
    });

    return {
      ok: checks.every((check) => check.ok),
      deploymentId: deployment.deploymentId,
      checks,
    };
  }

  assertCanDelete(deployment: DeploymentRecord): void {
    const result = this.runForDeployment(deployment);

    if (!result.ok) {
      const reasons = result.checks
        .filter((check) => !check.ok)
        .map((check) => `${check.name}: ${check.reason ?? 'FAILED'}`)
        .join(', ');

      throw new Error(
        `Delete preflight failed for ${deployment.deploymentId}: ${reasons}`,
      );
    }
  }

  private hasAnyManagedResource(deployment: DeploymentRecord): boolean {
    const resources = deployment.managedResources;

    return Boolean(
      resources.bucketName ||
        resources.certificateArn ||
        resources.cloudFrontDistributionId ||
        resources.repoName ||
        resources.route53AliasRecords?.length ||
        resources.validationRecordFqdns?.length,
    );
  }
}