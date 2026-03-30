import { getNextCreateStage } from './stages';
import type { AnyStage, DeploymentRecord, ManagedResources } from './types';
import type { StageDependencies } from './stage-dependencies';
import { createStageDependencies } from './stage-dependencies.factory';
import { DeploymentsRepository } from '../../repositories/deployments.repository';
import { OperationsRepository } from '../../repositories/operations.repository';
import { DeploymentStateService } from './deployment-state.service';
import { AuditService } from '../audit/audit.service';

export class DeploymentOrchestratorService {
  constructor(
    private readonly deploymentsRepository = new DeploymentsRepository(),
    private readonly operationsRepository = new OperationsRepository(),
    private readonly stateService = new DeploymentStateService(),
    private readonly auditService = new AuditService(),
    private readonly deps: StageDependencies = createStageDependencies(),
  ) {}

  async runCreate(deploymentId: string, operationId: string): Promise<void> {
    const existingDeployment = await this.deploymentsRepository.getById(deploymentId);
    if (!existingDeployment) {
      throw new Error('Deployment not found');
    }

    const now = new Date().toISOString();
    await this.operationsRepository.markRunning(operationId, now);

    let currentStage = existingDeployment.lastSuccessfulStage
      ? getNextCreateStage(existingDeployment.lastSuccessfulStage)
      : getNextCreateStage();

    while (currentStage) {
      const stage = currentStage;

      try {
        await this.runStageInternal(deploymentId, stage);
        currentStage = getNextCreateStage(stage);
      } catch (error) {
        await this.operationsRepository.markFailed(
          operationId,
          new Date().toISOString(),
          'STAGE_FAILED',
          error instanceof Error ? error.message : 'Unknown error',
        );

        return;
      }
    }

    await this.stateService.markDeploymentSucceeded(deploymentId);
    await this.operationsRepository.markSucceeded(
      operationId,
      new Date().toISOString(),
    );
  }

  async resume(deploymentId: string, operationId: string): Promise<void> {
    return this.runCreate(deploymentId, operationId);
  }

  async runSingleStage(
    deploymentId: string,
    operationId: string,
    stage: AnyStage,
  ): Promise<void> {
    const now = new Date().toISOString();
    await this.operationsRepository.markRunning(operationId, now);

    try {
      await this.runStageInternal(deploymentId, stage);

      await this.operationsRepository.markSucceeded(
        operationId,
        new Date().toISOString(),
      );
    } catch (error) {
      await this.operationsRepository.markFailed(
        operationId,
        new Date().toISOString(),
        'STAGE_FAILED',
        error instanceof Error ? error.message : 'Unknown error',
      );

      throw error;
    }
  }

  private async runStageInternal(
    deploymentId: string,
    stage: AnyStage,
  ): Promise<void> {
    const deployment = await this.requireDeployment(deploymentId);
  
    await this.stateService.startStage(deploymentId, stage);
  
    await this.auditService.write({
      deploymentId: deployment.deploymentId,
      tenantId: deployment.tenantId,
      customerId: deployment.customerId,
      actorId: deployment.triggeredBy ?? deployment.createdBy,
      eventType: 'STAGE_STARTED',
      metadata: { stage },
    });
  
    try {
      const output = await this.executeStage(deployment, stage);
  
      if (output?.managedResources) {
        const nextManagedResources = {
          ...deployment.managedResources,
          ...output.managedResources,
        };
  
        await this.stateService.updateManagedResources(
          deploymentId,
          nextManagedResources,
        );
      }
  
      await this.stateService.succeedStage(deploymentId, stage, output);
  
      await this.auditService.write({
        deploymentId: deployment.deploymentId,
        tenantId: deployment.tenantId,
        customerId: deployment.customerId,
        actorId: deployment.triggeredBy ?? deployment.createdBy,
        eventType: 'STAGE_SUCCEEDED',
        metadata: { stage },
      });
    } catch (error) {
      await this.stateService.failStage(deploymentId, stage, {
        errorCode: 'STAGE_FAILED',
        errorMessage:
          error instanceof Error ? error.message : 'Unknown error',
        retryable: true,
      });
  
      await this.auditService.write({
        deploymentId: deployment.deploymentId,
        tenantId: deployment.tenantId,
        customerId: deployment.customerId,
        actorId: deployment.triggeredBy ?? deployment.createdBy,
        eventType: 'STAGE_FAILED',
        metadata: {
          stage,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      });
  
      throw error;
    }
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
    stage: AnyStage,
  ): Promise<Record<string, unknown> | undefined> {
    switch (stage) {
      case 'DOMAIN_CHECK':
        return this.handleDomainCheck(deployment);
      case 'GITHUB_PROVISION':
        return this.handleGitHubProvision(deployment);
      case 'S3_BUCKET':
        return this.handleS3Bucket(deployment);
      case 'ACM_REQUEST':
        return this.handleAcmRequest(deployment);
      case 'ACM_VALIDATION_RECORDS':
        return this.handleAcmValidationRecords(deployment);
      case 'ACM_DNS_PROPAGATION':
        return this.handleAcmDnsPropagation(deployment);
      case 'ACM_WAIT':
        return this.handleAcmWait(deployment);
      case 'CLOUDFRONT':
        return this.handleCloudFront(deployment);
      case 'ROUTE53_ALIAS':
        return this.handleRoute53Alias(deployment);
      case 'GITHUB_DISPATCH':
        return this.handleGitHubDispatch(deployment);
      case 'DYNAMODB':
        return this.handleDynamoDbSync(deployment);
      case 'SQS':
        return this.handleSqs(deployment);
      default:
        throw new Error(`Unknown stage: ${stage}`);
    }
  }

  private async handleDomainCheck(
    deployment: DeploymentRecord,
  ): Promise<Record<string, unknown>> {
    if (deployment.managedResources.hostedZoneId) {
      return {
        domain: deployment.domain,
        rootDomain: deployment.rootDomain,
        hostedZoneId: deployment.managedResources.hostedZoneId,
        skipped: true,
      };
    }

    const result = await this.deps.domainCheck({
      domain: deployment.domain,
    });

    return {
      domain: result.domain,
      rootDomain: result.rootDomain,
      hostedZoneId: result.hostedZoneId,
      managedResources: {
        hostedZoneId: result.hostedZoneId,
      } satisfies Partial<ManagedResources>,
    };
  }

  private async handleGitHubProvision(
    deployment: DeploymentRecord,
  ): Promise<Record<string, unknown>> {
    if (deployment.managedResources.repoName) {
      return {
        repoName: deployment.managedResources.repoName,
        skipped: true,
      };
    }

    const result = await this.deps.githubProvision({
      customerId: deployment.customerId,
      domain: deployment.domain,
      projectName: undefined,
      packageCode: deployment.packageCode,
      addOns: deployment.addOns,
    });

    return {
      repoName: result.repoName,
      managedResources: {
        repoName: result.repoName,
      } satisfies Partial<ManagedResources>,
    };
  }

  private async handleS3Bucket(
    deployment: DeploymentRecord,
  ): Promise<Record<string, unknown>> {
    if (
      deployment.managedResources.bucketName &&
      deployment.managedResources.bucketRegionalDomainName
    ) {
      return {
        bucketName: deployment.managedResources.bucketName,
        bucketRegionalDomainName:
          deployment.managedResources.bucketRegionalDomainName,
        skipped: true,
      };
    }
  
    const result = await this.deps.s3Bucket({
      domain: deployment.domain,
    });
  
    return {
      bucketName: result.bucketName,
      bucketRegionalDomainName: result.bucketRegionalDomainName,
      managedResources: {
        bucketName: result.bucketName,
        bucketRegionalDomainName: result.bucketRegionalDomainName,
      } satisfies Partial<ManagedResources>,
    };
  }

  private async handleAcmRequest(
    deployment: DeploymentRecord,
  ): Promise<Record<string, unknown>> {
    if (deployment.managedResources.certificateArn) {
      return {
        certificateArn: deployment.managedResources.certificateArn,
        skipped: true,
      };
    }

    const result = await this.deps.acmRequest({
      domain: deployment.domain,
    });

    return {
      certificateArn: result.certificateArn,
      managedResources: {
        certificateArn: result.certificateArn,
      } satisfies Partial<ManagedResources>,
    };
  }

  private async handleAcmValidationRecords(
    deployment: DeploymentRecord,
  ): Promise<Record<string, unknown>> {
    if (!deployment.managedResources.certificateArn) {
      throw new Error('Missing certificateArn before ACM_VALIDATION_RECORDS');
    }
  
    if (!deployment.managedResources.hostedZoneId) {
      throw new Error('Missing hostedZoneId before ACM_VALIDATION_RECORDS');
    }
  
    if (
      deployment.managedResources.validationRecordFqdns &&
      deployment.managedResources.validationRecordFqdns.length > 0
    ) {
      return {
        validationRecordFqdns: deployment.managedResources.validationRecordFqdns,
        skipped: true,
      };
    }
  
    const result = await this.deps.acmValidationRecords({
      certificateArn: deployment.managedResources.certificateArn,
      hostedZoneId: deployment.managedResources.hostedZoneId,
    });
  
    return {
      validationRecords: result.validationRecords,
      validationRecordFqdns: result.validationRecordFqdns,
      managedResources: {
        validationRecordFqdns: result.validationRecordFqdns,
      } satisfies Partial<ManagedResources>,
    };
  }

  private async handleAcmDnsPropagation(
    deployment: DeploymentRecord,
  ): Promise<Record<string, unknown>> {
    const stageOutput =
      deployment.stageStates['ACM_VALIDATION_RECORDS']?.output?.validationRecords;

    if (!Array.isArray(stageOutput) || stageOutput.length === 0) {
      throw new Error('Missing validation records before ACM_DNS_PROPAGATION');
    }

    await this.deps.acmDnsPropagation({
      records: stageOutput as {
        name: string;
        type: string;
        value: string;
        fqdn?: string;
      }[],
    });

    return {
      propagationChecked: true,
    };
  }

  private async handleAcmWait(
    deployment: DeploymentRecord,
  ): Promise<Record<string, unknown>> {
    if (!deployment.managedResources.certificateArn) {
      throw new Error('Missing certificateArn before ACM_WAIT');
    }

    const result = await this.deps.acmWait({
      certificateArn: deployment.managedResources.certificateArn,
    });

    return {
      certificateArn: result.certificateArn,
      certificateStatus: result.certificateStatus,
    };
  }

  private async handleCloudFront(
    deployment: DeploymentRecord,
  ): Promise<Record<string, unknown>> {
    if (deployment.managedResources.cloudFrontDistributionId) {
      return {
        cloudFrontDistributionId:
          deployment.managedResources.cloudFrontDistributionId,
        cloudFrontDomainName: deployment.managedResources.cloudFrontDomainName,
        skipped: true,
      };
    }
  
    if (!deployment.managedResources.bucketName) {
      throw new Error('Missing bucketName before CLOUDFRONT');
    }
  
    if (!deployment.managedResources.bucketRegionalDomainName) {
      throw new Error('Missing bucketRegionalDomainName before CLOUDFRONT');
    }
  
    if (!deployment.managedResources.certificateArn) {
      throw new Error('Missing certificateArn before CLOUDFRONT');
    }
  
    const result = await this.deps.cloudFront({
      domain: deployment.domain,
      bucketName: deployment.managedResources.bucketName,
      bucketRegionalDomainName:
        deployment.managedResources.bucketRegionalDomainName,
      certificateArn: deployment.managedResources.certificateArn,
    });
  
    return {
      cloudFrontDistributionId: result.distributionId,
      cloudFrontDomainName: result.domainName,
      managedResources: {
        cloudFrontDistributionId: result.distributionId,
        cloudFrontDomainName: result.domainName,
        cloudFrontDistributionArn: result.arn,
        oacId: result.oacId,
      } satisfies Partial<ManagedResources>,
    };
  }

  private async handleRoute53Alias(
    deployment: DeploymentRecord,
  ): Promise<Record<string, unknown>> {
    if (deployment.managedResources.route53AliasRecords?.length) {
      return {
        route53AliasRecords: deployment.managedResources.route53AliasRecords,
        skipped: true,
      };
    }

    if (!deployment.managedResources.hostedZoneId) {
      throw new Error('Missing hostedZoneId before ROUTE53_ALIAS');
    }

    if (!deployment.managedResources.cloudFrontDomainName) {
      throw new Error('Missing cloudFrontDomainName before ROUTE53_ALIAS');
    }

    const result = await this.deps.route53Alias({
      domain: deployment.domain,
      rootDomain: deployment.rootDomain,
      hostedZoneId: deployment.managedResources.hostedZoneId,
      cloudFrontDomainName: deployment.managedResources.cloudFrontDomainName,
    });

    return {
      route53AliasRecords: result.aliasRecords,
      managedResources: {
        route53AliasRecords: result.aliasRecords,
      } satisfies Partial<ManagedResources>,
    };
  }

  private async handleGitHubDispatch(
    deployment: DeploymentRecord,
  ): Promise<Record<string, unknown>> {
    if (!deployment.managedResources.repoName) {
      throw new Error('Missing repoName before GITHUB_DISPATCH');
    }

    if (!deployment.managedResources.bucketName) {
      throw new Error('Missing bucketName before GITHUB_DISPATCH');
    }

    if (!deployment.managedResources.cloudFrontDistributionId) {
      throw new Error('Missing cloudFrontDistributionId before GITHUB_DISPATCH');
    }

    const result = await this.deps.githubDispatch({
      repoName: deployment.managedResources.repoName,
      domain: deployment.domain,
      bucketName: deployment.managedResources.bucketName,
      cloudFrontDistributionId:
        deployment.managedResources.cloudFrontDistributionId,
    });

    return {
      workflowRunId: result.workflowRunId,
      managedResources: {
        workflowRunId: result.workflowRunId,
      } satisfies Partial<ManagedResources>,
    };
  }

  private async handleDynamoDbSync(
    deployment: DeploymentRecord,
  ): Promise<Record<string, unknown>> {
    await this.deps.dynamoDbSync({
      deploymentId: deployment.deploymentId,
    });

    return {
      syncedAt: new Date().toISOString(),
    };
  }

  private async handleSqs(
    deployment: DeploymentRecord,
  ): Promise<Record<string, unknown>> {
    const result = await this.deps.sqs({
      deploymentId: deployment.deploymentId,
      customerId: deployment.customerId,
      domain: deployment.domain,
    });

    return {
      queued: true,
      queueType: result.queueType,
      messageId: result.messageId,
    };
  }
}