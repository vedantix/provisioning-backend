import type { AnyStage, FailureCategory } from './types';
import { DeploymentsRepository } from '../../repositories/deployments.repository';

export class DeploymentStateService {
  constructor(
    private readonly deploymentsRepository = new DeploymentsRepository(),
  ) {}

  async startStage(deploymentId: string, stage: AnyStage): Promise<void> {
    const now = new Date().toISOString();
    await this.deploymentsRepository.markInProgress(deploymentId, stage, now);
  }

  async startDeleteStage(deploymentId: string, stage: AnyStage): Promise<void> {
    const now = new Date().toISOString();
    await this.deploymentsRepository.markDeleting(deploymentId, stage, now);
  }

  async succeedStage(
    deploymentId: string,
    stage: AnyStage,
    output?: Record<string, unknown>,
  ): Promise<void> {
    const now = new Date().toISOString();
    await this.deploymentsRepository.markStageSucceeded(deploymentId, stage, now, output);
  }

  async failStage(
    deploymentId: string,
    stage: AnyStage,
    params: {
      errorCode: string;
      errorMessage: string;
      retryable?: boolean;
      failureCategory?: FailureCategory;
    },
  ): Promise<void> {
    const now = new Date().toISOString();
    await this.deploymentsRepository.markStageFailed(deploymentId, stage, now, params);
  }

  async markDeploymentSucceeded(deploymentId: string): Promise<void> {
    const now = new Date().toISOString();
    await this.deploymentsRepository.markDeploymentSucceeded(deploymentId, now);
  }

  async markDeploymentDeleted(deploymentId: string): Promise<void> {
    const now = new Date().toISOString();
    await this.deploymentsRepository.markDeploymentDeleted(deploymentId, now);
  }

  async updateManagedResources(
    deploymentId: string,
    managedResources: Record<string, unknown>,
  ): Promise<void> {
    const now = new Date().toISOString();
    await this.deploymentsRepository.updateManagedResources(
      deploymentId,
      managedResources,
      now,
    );
  }
}