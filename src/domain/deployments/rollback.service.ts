import { DeploymentsRepository } from '../../repositories/deployments.repository';
import { OperationsRepository } from '../../repositories/operations.repository';
import { DeploymentStateService } from './deployment-state.service';
import { AuditService } from '../audit/audit.service';
import type { DeploymentRecord } from './types';

type RollbackInput = {
  targetRef?: string;
  actorId?: string;
};

type GithubDispatchPayload = {
  ref: string;
  inputs: {
    bucket: string;
    distribution_id: string;
    mode: 'rollback';
    target_ref: string;
  };
};

export class RollbackService {
  constructor(
    private readonly deploymentsRepository = new DeploymentsRepository(),
    private readonly operationsRepository = new OperationsRepository(),
    private readonly stateService = new DeploymentStateService(),
    private readonly auditService = new AuditService(),
  ) {}

  async rollback(
    deploymentId: string,
    operationId: string,
    input: RollbackInput = {},
  ): Promise<void> {
    const deployment = await this.requireDeployment(deploymentId);
    const now = new Date().toISOString();

    await this.operationsRepository.markRunning(operationId, now);

    try {
      const targetRef = this.resolveTargetRef(deployment, input.targetRef);

      await this.stateService.startStage(deploymentId, 'GITHUB_DISPATCH');

      await this.auditService.write({
        deploymentId: deployment.deploymentId,
        operationId,
        tenantId: deployment.tenantId,
        customerId: deployment.customerId,
        actorId:
          input.actorId ?? deployment.triggeredBy ?? deployment.createdBy,
        eventType: 'STAGE_STARTED',
        metadata: {
          stage: 'GITHUB_DISPATCH',
          mode: 'rollback',
          targetRef,
        },
      });

      await this.dispatchRollbackWorkflow(deployment, targetRef);

      await this.stateService.succeedStage(deploymentId, 'GITHUB_DISPATCH', {
        mode: 'rollback',
        targetRef,
      });

      await this.stateService.updateManagedResources(deploymentId, {
        ...deployment.managedResources,
        lastGitRefDeployed: targetRef,
      });

      await this.auditService.write({
        deploymentId: deployment.deploymentId,
        operationId,
        tenantId: deployment.tenantId,
        customerId: deployment.customerId,
        actorId:
          input.actorId ?? deployment.triggeredBy ?? deployment.createdBy,
        eventType: 'STAGE_SUCCEEDED',
        metadata: {
          stage: 'GITHUB_DISPATCH',
          mode: 'rollback',
          targetRef,
        },
      });

      await this.operationsRepository.markSucceeded(
        operationId,
        new Date().toISOString(),
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown rollback error';

      await this.stateService.failStage(deploymentId, 'GITHUB_DISPATCH', {
        errorCode: 'ROLLBACK_FAILED',
        errorMessage,
        retryable: true,
      });

      await this.auditService.write({
        deploymentId: deployment.deploymentId,
        operationId,
        tenantId: deployment.tenantId,
        customerId: deployment.customerId,
        actorId:
          input.actorId ?? deployment.triggeredBy ?? deployment.createdBy,
        eventType: 'STAGE_FAILED',
        metadata: {
          stage: 'GITHUB_DISPATCH',
          mode: 'rollback',
          error: errorMessage,
        },
      });

      await this.operationsRepository.markFailed(
        operationId,
        new Date().toISOString(),
        'ROLLBACK_FAILED',
        errorMessage,
      );

      throw error;
    }
  }

  private resolveTargetRef(
    deployment: DeploymentRecord,
    explicitTargetRef?: string,
  ): string {
    const candidate =
      explicitTargetRef ||
      deployment.managedResources.rollbackRef ||
      deployment.managedResources.lastGitRefDeployed;

    if (!candidate || !candidate.trim()) {
      throw new Error('No rollback targetRef available');
    }

    return candidate.trim();
  }

  private async dispatchRollbackWorkflow(
    deployment: DeploymentRecord,
    targetRef: string,
  ): Promise<void> {
    const repoName = deployment.managedResources.repoName;
    const bucketName = deployment.managedResources.bucketName;
    const distributionId = deployment.managedResources.cloudFrontDistributionId;
    const token = process.env.GITHUB_TOKEN;
    const owner = process.env.GITHUB_OWNER;

    if (!repoName) {
      throw new Error('Missing managed resource repoName for rollback');
    }

    if (!bucketName) {
      throw new Error('Missing managed resource bucketName for rollback');
    }

    if (!distributionId) {
      throw new Error(
        'Missing managed resource cloudFrontDistributionId for rollback',
      );
    }

    if (!token) {
      throw new Error('Missing GITHUB_TOKEN for rollback workflow dispatch');
    }

    if (!owner) {
      throw new Error('Missing GITHUB_OWNER for rollback workflow dispatch');
    }

    const workflowPath =
      deployment.managedResources.githubWorkflowFilePath ||
      '.github/workflows/deploy.yml';

    const url = `https://api.github.com/repos/${owner}/${repoName}/actions/workflows/${encodeURIComponent(
      workflowPath,
    )}/dispatches`;

    const body: GithubDispatchPayload = {
      ref: 'main',
      inputs: {
        bucket: bucketName,
        distribution_id: distributionId,
        mode: 'rollback',
        target_ref: targetRef,
      },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const responseText = await response.text();
      throw new Error(
        `GitHub rollback dispatch failed: ${response.status} ${responseText}`,
      );
    }
  }

  private async requireDeployment(
    deploymentId: string,
  ): Promise<DeploymentRecord> {
    const deployment = await this.deploymentsRepository.getById(deploymentId);

    if (!deployment) {
      throw new Error('Deployment not found');
    }

    return deployment;
  }
}