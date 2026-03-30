import { DeploymentOrchestratorService } from './deployment-orchestrator.service';
import { DeploymentsRepository } from '../../repositories/deployments.repository';
import { DeploymentStateService } from './deployment-state.service';

export class RedeployService {
  constructor(
    private readonly deploymentsRepository = new DeploymentsRepository(),
    private readonly stateService = new DeploymentStateService(),
    private readonly orchestrator = new DeploymentOrchestratorService(),
  ) {}

  async startSoftRedeploy(
    deploymentId: string,
    operationId: string,
  ): Promise<void> {
    const deployment = await this.deploymentsRepository.getById(deploymentId);
    if (!deployment) {
      throw new Error('Deployment not found');
    }

    await this.stateService.startStage(deploymentId, 'GITHUB_DISPATCH');
    await this.orchestrator.runSingleStage(deploymentId, operationId, 'GITHUB_DISPATCH');
    await this.stateService.markDeploymentSucceeded(deploymentId);
  }
}