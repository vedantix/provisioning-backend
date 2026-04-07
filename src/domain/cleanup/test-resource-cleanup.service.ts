import { DeleteDeploymentService } from '../deployments/delete-deployment.service';
import { DeploymentsRepository } from '../../repositories/deployments.repository';
import { OperationsRepository } from '../../repositories/operations.repository';
import type { DeploymentRecord } from '../deployments/types';
import { env } from '../../config/env';

export type CleanupCandidate = {
  deploymentId: string;
  tenantId: string;
  customerId: string;
  domain: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  reason:
    | 'FAILED_TEST_DEPLOYMENT'
    | 'DELETING_STALE_TEST_DEPLOYMENT'
    | 'OLD_TEST_DEPLOYMENT';
};

export type CleanupRunResult = {
  requested: number;
  started: Array<{
    deploymentId: string;
    operationId: string;
  }>;
  skipped: Array<{
    deploymentId: string;
    reason: string;
  }>;
};

function createCleanupOperationId(deploymentId: string): string {
  return `cleanup_${deploymentId}_${Date.now()}`;
}

export class TestResourceCleanupService {
  constructor(
    private readonly deploymentsRepository = new DeploymentsRepository(),
    private readonly operationsRepository = new OperationsRepository(),
    private readonly deleteDeploymentService = new DeleteDeploymentService(),
  ) {}

  async listCandidates(): Promise<CleanupCandidate[]> {
    const deployments =
      await this.deploymentsRepository.listCleanupCandidates?.();

    if (!Array.isArray(deployments)) {
      return [];
    }

    return deployments
      .filter((deployment): deployment is DeploymentRecord =>
        Boolean(deployment && typeof deployment === 'object'),
      )
      .filter((deployment) => this.isTestDeployment(deployment))
      .filter((deployment) => this.isOldEnough(deployment))
      .map((deployment) => ({
        deploymentId: deployment.deploymentId,
        tenantId: deployment.tenantId,
        customerId: deployment.customerId,
        domain: deployment.domain,
        status: deployment.status,
        createdAt: deployment.createdAt,
        updatedAt: deployment.updatedAt,
        reason: this.resolveReason(deployment),
      }));
  }

  async runCleanup(limit = 25): Promise<CleanupRunResult> {
    if (!env.allowTestResourceCleanup) {
      throw new Error('Test resource cleanup is disabled by configuration');
    }

    const candidates = await this.listCandidates();
    const selected = candidates.slice(0, limit);

    const result: CleanupRunResult = {
      requested: selected.length,
      started: [],
      skipped: [],
    };

    for (const candidate of selected) {
      try {
        const existingOperations =
          await this.operationsRepository.listByDeploymentId(
            candidate.deploymentId,
          );

        const blocking = existingOperations.find(
          (operation) =>
            operation.status === 'ACCEPTED' || operation.status === 'RUNNING',
        );

        if (blocking) {
          result.skipped.push({
            deploymentId: candidate.deploymentId,
            reason: `Blocking operation exists: ${blocking.operationId}`,
          });
          continue;
        }

        const operationId = createCleanupOperationId(candidate.deploymentId);

        await this.operationsRepository.create({
          operationId,
          deploymentId: candidate.deploymentId,
          tenantId: candidate.tenantId,
          customerId: candidate.customerId,
          type: 'DELETE',
          status: 'ACCEPTED',
          requestHash: `cleanup:${candidate.deploymentId}:${candidate.reason}`,
          source: 'SYSTEM',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });

        void this.deleteDeploymentService.runDelete(
          candidate.deploymentId,
          operationId,
        );

        result.started.push({
          deploymentId: candidate.deploymentId,
          operationId,
        });
      } catch (error) {
        result.skipped.push({
          deploymentId: candidate.deploymentId,
          reason: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return result;
  }

  private isTestDeployment(deployment: DeploymentRecord): boolean {
    const domain = deployment.domain.toLowerCase();

    return (
      domain.startsWith('test-') ||
      domain.includes('.test-') ||
      deployment.customerId.toLowerCase().includes('test') ||
      deployment.deploymentId.toLowerCase().includes('test')
    );
  }

  private isOldEnough(deployment: DeploymentRecord): boolean {
    const minAgeMs = env.cleanupCandidateMinAgeHours * 60 * 60 * 1000;
    const updatedAt = new Date(deployment.updatedAt).getTime();

    return Date.now() - updatedAt >= minAgeMs;
  }

  private resolveReason(
    deployment: DeploymentRecord,
  ): CleanupCandidate['reason'] {
    if (deployment.status === 'FAILED') {
      return 'FAILED_TEST_DEPLOYMENT';
    }

    if (deployment.status === 'DELETING') {
      return 'DELETING_STALE_TEST_DEPLOYMENT';
    }

    return 'OLD_TEST_DEPLOYMENT';
  }
}