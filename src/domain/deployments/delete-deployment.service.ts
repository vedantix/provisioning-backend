import { getNextDeleteStage } from './delete-stages';
import type { DeleteStage, DeploymentRecord, ManagedResources } from './types';
import type { DeleteStageDependencies } from './delete-stage-dependencies';
import { createDeleteStageDependencies } from './delete-stage-dependencies.factory';
import { DeploymentsRepository } from '../../repositories/deployments.repository';
import { OperationsRepository } from '../../repositories/operations.repository';
import { DeploymentStateService } from './deployment-state.service';
import { AuditService } from '../audit/audit.service';

export class DeleteDeploymentService {
  constructor(
    private readonly deploymentsRepository = new DeploymentsRepository(),
    private readonly operationsRepository = new OperationsRepository(),
    private readonly stateService = new DeploymentStateService(),
    private readonly deps: DeleteStageDependencies = createDeleteStageDependencies(),
    private readonly auditService = new AuditService(),
  ) {}

  async runDelete(deploymentId: string, operationId: string): Promise<void> {
    const deployment = await this.requireDeployment(deploymentId);

    const now = new Date().toISOString();
    await this.operationsRepository.markRunning(operationId, now);

    let currentStage = this.getResumeStage(deployment);

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
          actorId: currentDeployment.triggeredBy ?? currentDeployment.createdBy,
          eventType: 'STAGE_STARTED',
          metadata: { stage, mode: 'delete' },
        });

        const output = await this.executeStage(currentDeployment, stage);

        if (output?.managedResources) {
          const nextManagedResources = {
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
          actorId: currentDeployment.triggeredBy ?? currentDeployment.createdBy,
          eventType: 'STAGE_SUCCEEDED',
          metadata: { stage, mode: 'delete' },
        });

        currentStage = getNextDeleteStage(stage);
      } catch (error) {
        await this.stateService.failStage(deploymentId, stage, {
          errorCode: 'DELETE_STAGE_FAILED',
          errorMessage:
            error instanceof Error ? error.message : 'Unknown error',
          retryable: true,
        });

        await this.auditService.write({
          deploymentId: deployment.deploymentId,
          operationId,
          tenantId: deployment.tenantId,
          customerId: deployment.customerId,
          actorId: deployment.triggeredBy ?? deployment.createdBy,
          eventType: 'STAGE_FAILED',
          metadata: {
            stage,
            mode: 'delete',
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        });

        await this.operationsRepository.markFailed(
          operationId,
          new Date().toISOString(),
          'DELETE_STAGE_FAILED',
          error instanceof Error ? error.message : 'Unknown error',
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

  private getResumeStage(deployment: DeploymentRecord): DeleteStage | undefined {
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

  private async requireDeployment(deploymentId: string): Promise<DeploymentRecord> {
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
    switch (stage) {
      case 'DELETE_DOMAIN_ALIAS':
        return this.handleDeleteDomainAlias(deployment);

      case 'DISABLE_CLOUDFRONT':
        return this.handleDisableCloudFront(deployment);

      case 'WAIT_CLOUDFRONT_DISABLED':
        return this.handleWaitCloudFrontDisabled(deployment);

      case 'DELETE_CLOUDFRONT':
        return this.handleDeleteCloudFront(deployment);

      case 'EMPTY_S3_BUCKET':
        return this.handleEmptyS3Bucket(deployment);

      case 'DELETE_S3_BUCKET':
        return this.handleDeleteS3Bucket(deployment);

      case 'DELETE_ACM_VALIDATION_RECORDS':
        return this.handleDeleteAcmValidationRecords(deployment);

      case 'DELETE_ACM_CERTIFICATE':
        return this.handleDeleteAcmCertificate(deployment);

      case 'FINALIZE_DELETE':
        return this.handleFinalizeDelete(deployment);

      default:
        throw new Error(`Unknown delete stage: ${stage}`);
    }
  }

  private async handleDeleteDomainAlias(
    deployment: DeploymentRecord,
  ): Promise<Record<string, unknown>> {
    if (!deployment.managedResources.hostedZoneId) {
      return { skipped: true, reason: 'No hostedZoneId' };
    }

    const result = await this.deps.deleteDomainAlias({
      domain: deployment.domain,
      rootDomain: deployment.rootDomain,
      hostedZoneId: deployment.managedResources.hostedZoneId,
      aliasRecords: deployment.managedResources.route53AliasRecords,
    });

    return {
      removedRecords: result.removedRecords,
      managedResources: {
        route53AliasRecords: [],
      } satisfies Partial<ManagedResources>,
    };
  }

  private async handleDisableCloudFront(
    deployment: DeploymentRecord,
  ): Promise<Record<string, unknown>> {
    if (!deployment.managedResources.cloudFrontDistributionId) {
      return { skipped: true, reason: 'No cloudFrontDistributionId' };
    }

    const result = await this.deps.disableCloudFront({
      distributionId: deployment.managedResources.cloudFrontDistributionId,
    });

    return {
      distributionId: result.distributionId,
      disabled: result.disabled,
    };
  }

  private async handleWaitCloudFrontDisabled(
    deployment: DeploymentRecord,
  ): Promise<Record<string, unknown>> {
    if (!deployment.managedResources.cloudFrontDistributionId) {
      return { skipped: true, reason: 'No cloudFrontDistributionId' };
    }

    const result = await this.deps.waitCloudFrontDisabled({
      distributionId: deployment.managedResources.cloudFrontDistributionId,
    });

    return {
      distributionId: result.distributionId,
      status: result.status,
    };
  }

  private async handleDeleteCloudFront(
    deployment: DeploymentRecord,
  ): Promise<Record<string, unknown>> {
    if (!deployment.managedResources.cloudFrontDistributionId) {
      return { skipped: true, reason: 'No cloudFrontDistributionId' };
    }

    const result = await this.deps.deleteCloudFront({
      distributionId: deployment.managedResources.cloudFrontDistributionId,
    });

    return {
      distributionId: result.distributionId,
      deleted: result.deleted,
      managedResources: {
        cloudFrontDistributionId: undefined,
        cloudFrontDomainName: undefined,
        cloudFrontDistributionArn: undefined,
        oacId: undefined,
      } satisfies Partial<ManagedResources>,
    };
  }

  private async handleEmptyS3Bucket(
    deployment: DeploymentRecord,
  ): Promise<Record<string, unknown>> {
    if (!deployment.managedResources.bucketName) {
      return { skipped: true, reason: 'No bucketName' };
    }

    const result = await this.deps.emptyS3Bucket({
      bucketName: deployment.managedResources.bucketName,
    });

    return {
      bucketName: result.bucketName,
      emptied: result.emptied,
    };
  }

  private async handleDeleteS3Bucket(
    deployment: DeploymentRecord,
  ): Promise<Record<string, unknown>> {
    if (!deployment.managedResources.bucketName) {
      return { skipped: true, reason: 'No bucketName' };
    }

    const result = await this.deps.deleteS3Bucket({
      bucketName: deployment.managedResources.bucketName,
    });

    return {
      bucketName: result.bucketName,
      deleted: result.deleted,
      managedResources: {
        bucketName: undefined,
        bucketRegionalDomainName: undefined,
      } satisfies Partial<ManagedResources>,
    };
  }

  private async handleDeleteAcmValidationRecords(
    deployment: DeploymentRecord,
  ): Promise<Record<string, unknown>> {
    if (!deployment.managedResources.hostedZoneId) {
      return { skipped: true, reason: 'No hostedZoneId' };
    }

    const result = await this.deps.deleteAcmValidationRecords({
      hostedZoneId: deployment.managedResources.hostedZoneId,
      validationRecordFqdns: deployment.managedResources.validationRecordFqdns,
    });

    return {
      removedValidationRecordFqdns: result.removedValidationRecordFqdns,
      managedResources: {
        validationRecordFqdns: [],
      } satisfies Partial<ManagedResources>,
    };
  }

  private async handleDeleteAcmCertificate(
    deployment: DeploymentRecord,
  ): Promise<Record<string, unknown>> {
    if (!deployment.managedResources.certificateArn) {
      return { skipped: true, reason: 'No certificateArn' };
    }

    const result = await this.deps.deleteAcmCertificate({
      certificateArn: deployment.managedResources.certificateArn,
    });

    return {
      certificateArn: result.certificateArn,
      deleted: result.deleted,
      managedResources: {
        certificateArn: undefined,
      } satisfies Partial<ManagedResources>,
    };
  }

  private async handleFinalizeDelete(
    deployment: DeploymentRecord,
  ): Promise<Record<string, unknown>> {
    return {
      deploymentId: deployment.deploymentId,
      finalizedAt: new Date().toISOString(),
    };
  }
}