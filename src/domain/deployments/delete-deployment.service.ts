import { getNextDeleteStage } from './delete-stages';
import type {
  DeleteStage,
  DeploymentRecord,
  ManagedResources,
} from './types';
import { DeploymentsRepository } from '../../repositories/deployments.repository';
import { OperationsRepository } from '../../repositories/operations.repository';
import { DeploymentStateService } from './deployment-state.service';
import { AuditService } from '../audit/audit.service';
import { DeletePreflightService } from './delete-preflight.service';
import {
  DeleteStageExecutor,
  type DeleteStageExecutionResult,
} from './delete-stage-executor';

export class DeleteDeploymentService {
  constructor(
    private readonly deploymentsRepository = new DeploymentsRepository(),
    private readonly operationsRepository = new OperationsRepository(),
    private readonly stateService = new DeploymentStateService(),
    private readonly auditService = new AuditService(),
    private readonly preflightService = new DeletePreflightService(),
    private readonly stageExecutor = new DeleteStageExecutor(),
  ) {}

  async runDelete(deploymentId: string, operationId: string): Promise<void> {
    const initialDeployment = await this.requireDeployment(deploymentId);

    this.preflightService.assertCanDelete(initialDeployment);

    const now = new Date().toISOString();
    await this.operationsRepository.markRunning(operationId, now);

    let currentStage = this.getResumeStage(initialDeployment);

    while (currentStage) {
      const stage = currentStage;

      try {
        const currentDeployment = await this.requireDeployment(deploymentId);

        await this.stateService.startDeleteStage(deploymentId, stage);

        await this.auditService.write({
          deploymentId: currentDeployment.deploymentId,
          operationId,
          tenantId: currentDeployment.tenantId,
          customerId: currentDeployment.customerId,
          actorId:
            currentDeployment.triggeredBy ?? currentDeployment.createdBy,
          eventType: 'STAGE_STARTED',
          metadata: {
            stage,
            mode: 'delete',
          },
        });

        const output = await this.executeStage(currentDeployment, stage);

        if (this.hasManagedResourcesPatch(output)) {
          const nextManagedResources: ManagedResources = {
            ...currentDeployment.managedResources,
            ...output.managedResources,
          };

          await this.stateService.updateManagedResources(
            deploymentId,
            nextManagedResources,
          );
        }

        await this.stateService.succeedStage(deploymentId, stage, output);

        await this.auditService.write({
          deploymentId: currentDeployment.deploymentId,
          operationId,
          tenantId: currentDeployment.tenantId,
          customerId: currentDeployment.customerId,
          actorId:
            currentDeployment.triggeredBy ?? currentDeployment.createdBy,
          eventType: 'STAGE_SUCCEEDED',
          metadata: {
            stage,
            mode: 'delete',
            output,
          },
        });

        currentStage = getNextDeleteStage(stage);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';

        const failedDeployment = await this.requireDeployment(deploymentId);

        await this.stateService.failStage(deploymentId, stage, {
          errorCode: 'DELETE_STAGE_FAILED',
          errorMessage,
          retryable: true,
        });

        await this.auditService.write({
          deploymentId: failedDeployment.deploymentId,
          operationId,
          tenantId: failedDeployment.tenantId,
          customerId: failedDeployment.customerId,
          actorId:
            failedDeployment.triggeredBy ?? failedDeployment.createdBy,
          eventType: 'STAGE_FAILED',
          metadata: {
            stage,
            mode: 'delete',
            error: errorMessage,
          },
        });

        await this.operationsRepository.markFailed(
          operationId,
          new Date().toISOString(),
          'DELETE_STAGE_FAILED',
          errorMessage,
        );

        return;
      }
    }

    await this.stateService.markDeploymentDeleted(deploymentId);

    await this.operationsRepository.markSucceeded(
      operationId,
      new Date().toISOString(),
    );
  }

  private getResumeStage(
    deployment: DeploymentRecord,
  ): DeleteStage | undefined {
    const current = deployment.currentStage;

    if (
      current === 'DELETE_DOMAIN_ALIAS' ||
      current === 'DISABLE_CLOUDFRONT' ||
      current === 'WAIT_CLOUDFRONT_DISABLED' ||
      current === 'DELETE_CLOUDFRONT' ||
      current === 'EMPTY_S3_BUCKET' ||
      current === 'DELETE_S3_BUCKET' ||
      current === 'DELETE_ACM_VALIDATION_RECORDS' ||
      current === 'DELETE_ACM_CERTIFICATE' ||
      current === 'FINALIZE_DELETE'
    ) {
      return current;
    }

    return getNextDeleteStage();
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

  private async executeStage(
    deployment: DeploymentRecord,
    stage: DeleteStage,
  ): Promise<Record<string, unknown> | undefined> {
    const result = await this.stageExecutor.execute(stage, deployment);
    return this.toStageOutput(result);
  }

  private toStageOutput(
    result: DeleteStageExecutionResult,
  ): Record<string, unknown> {
    return {
      stage: result.stage,
      skippedBecauseMissing: result.skippedBecauseMissing ?? false,
      ...(result.details ?? {}),
    };
  }

  private hasManagedResourcesPatch(
    value: Record<string, unknown> | undefined,
  ): value is Record<string, unknown> & {
    managedResources: Partial<ManagedResources>;
  } {
    if (!value || typeof value !== 'object') {
      return false;
    }

    if (!('managedResources' in value)) {
      return false;
    }

    const candidate = (value as { managedResources?: unknown }).managedResources;
    return Boolean(candidate && typeof candidate === 'object');
  }
}