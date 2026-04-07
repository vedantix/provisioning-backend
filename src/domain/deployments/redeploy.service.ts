import { DeploymentOrchestratorService } from './deployment-orchestrator.service';
import { DeploymentsRepository } from '../../repositories/deployments.repository';
import { DeploymentStateService } from './deployment-state.service';
import type { AnyStage, DeploymentRecord } from './types';
import { DeploymentConsistencyService } from '../consistency/deployment-consistency.service';

export type RedeployMode =
  | 'CONTENT_ONLY'
  | 'REPAIR_INFRA'
  | 'FULL_RECONCILE';

const REPAIR_INFRA_STAGES: AnyStage[] = [
  'S3_BUCKET',
  'ACM_REQUEST',
  'ACM_VALIDATION_RECORDS',
  'ACM_DNS_PROPAGATION',
  'ACM_WAIT',
  'CLOUDFRONT',
  'ROUTE53_ALIAS',
  'GITHUB_DISPATCH',
  'DYNAMODB',
  'SQS',
];

export class RedeployService {
  constructor(
    private readonly deploymentsRepository = new DeploymentsRepository(),
    private readonly stateService = new DeploymentStateService(),
    private readonly orchestrator = new DeploymentOrchestratorService(),
    private readonly consistencyService = new DeploymentConsistencyService(),
  ) {}

  async startRedeploy(
    deploymentId: string,
    operationId: string,
    mode: RedeployMode = 'CONTENT_ONLY',
  ): Promise<void> {
    const deployment = await this.requireDeployment(deploymentId);

    switch (mode) {
      case 'CONTENT_ONLY':
        await this.startContentOnlyRedeploy(deployment, operationId);
        return;

      case 'REPAIR_INFRA':
        await this.startRepairInfraRedeploy(deployment, operationId);
        return;

      case 'FULL_RECONCILE':
        await this.startFullReconcileRedeploy(deployment, operationId);
        return;

      default: {
        const exhaustiveCheck: never = mode;
        throw new Error(`Unsupported redeploy mode: ${exhaustiveCheck}`);
      }
    }
  }

  async startSoftRedeploy(
    deploymentId: string,
    operationId: string,
  ): Promise<void> {
    await this.startRedeploy(deploymentId, operationId, 'CONTENT_ONLY');
  }

  private async startContentOnlyRedeploy(
    deployment: DeploymentRecord,
    operationId: string,
  ): Promise<void> {
    this.assertContentOnlyPreconditions(deployment);

    await this.stateService.startStage(
      deployment.deploymentId,
      'GITHUB_DISPATCH',
    );

    await this.orchestrator.runSingleStage(
      deployment.deploymentId,
      operationId,
      'GITHUB_DISPATCH',
    );

    await this.stateService.markDeploymentSucceeded(deployment.deploymentId);

    await this.updateConsistencySnapshot(deployment.deploymentId);
  }

  private async startRepairInfraRedeploy(
    deployment: DeploymentRecord,
    operationId: string,
  ): Promise<void> {
    for (const stage of REPAIR_INFRA_STAGES) {
      await this.orchestrator.runSingleStage(
        deployment.deploymentId,
        operationId,
        stage,
      );
    }

    await this.stateService.markDeploymentSucceeded(deployment.deploymentId);

    await this.consistencyService.assertDeploymentState(
      deployment.deploymentId,
    );

    await this.updateConsistencySnapshot(deployment.deploymentId);
  }

  private async startFullReconcileRedeploy(
    deployment: DeploymentRecord,
    operationId: string,
  ): Promise<void> {
    await this.orchestrator.resume(deployment.deploymentId, operationId);

    await this.consistencyService.assertDeploymentState(
      deployment.deploymentId,
    );

    await this.updateConsistencySnapshot(deployment.deploymentId);
  }

  private async updateConsistencySnapshot(
    deploymentId: string,
  ): Promise<void> {
    const deployment = await this.requireDeployment(deploymentId);
    const consistency =
      await this.consistencyService.checkDeploymentState(deployment);

    await this.deploymentsRepository.updateManagedResources(
      deploymentId,
      {
        ...deployment.managedResources,
        consistency: {
          ok: consistency.ok,
          checkedAt: new Date().toISOString(),
          checks: consistency.checks,
        },
      },
      new Date().toISOString(),
    );
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

  private assertContentOnlyPreconditions(deployment: DeploymentRecord): void {
    if (!deployment.managedResources.repoName) {
      throw new Error('Missing repoName for CONTENT_ONLY redeploy');
    }

    if (!deployment.managedResources.bucketName) {
      throw new Error('Missing bucketName for CONTENT_ONLY redeploy');
    }

    if (!deployment.managedResources.cloudFrontDistributionId) {
      throw new Error(
        'Missing cloudFrontDistributionId for CONTENT_ONLY redeploy',
      );
    }
  }
}