import { getNextCreateStage } from './stages';
import type { AnyStage, DeploymentRecord, ManagedResources } from './types';
import type { StageDependencies } from './stage-dependencies';
import { createStageDependencies } from './stage-dependencies.factory';
import { DeploymentsRepository } from '../../repositories/deployments.repository';
import { OperationsRepository } from '../../repositories/operations.repository';
import { CustomersRepository } from '../../modules/customers/repositories/customers.repository';
import { DeploymentStateService } from './deployment-state.service';
import { AuditService } from '../audit/audit.service';

function removeUndefinedValues<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .filter((item) => item !== undefined)
      .map((item) => removeUndefinedValues(item)) as T;
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, removeUndefinedValues(item)]),
    ) as T;
  }

  return value;
}

export class DeploymentOrchestratorService {
  constructor(
    private readonly deploymentsRepository = new DeploymentsRepository(),
    private readonly operationsRepository = new OperationsRepository(),
    private readonly stateService = new DeploymentStateService(),
    private readonly auditService = new AuditService(),
    private readonly deps: StageDependencies = createStageDependencies(),
    private readonly customersRepository = new CustomersRepository(),
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
    await this.markCustomerLive(deploymentId);
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
      const sanitizedOutput = output ? removeUndefinedValues(output) : output;
  
      if (sanitizedOutput?.managedResources) {
        const nextManagedResources = {
          ...deployment.managedResources,
          ...sanitizedOutput.managedResources,
        };
  
        await this.stateService.updateManagedResources(
          deploymentId,
          nextManagedResources,
        );
      }
  
      await this.stateService.succeedStage(deploymentId, stage, sanitizedOutput);
  
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

  private async markCustomerLive(deploymentId: string): Promise<void> {
    const deployment = await this.deploymentsRepository.getById(deploymentId);
    if (!deployment) {
      return;
    }

    await this.customersRepository.markDeploymentLive({
      customerId: deployment.customerId,
      updatedAt: new Date().toISOString(),
      updatedBy:
        deployment.triggeredBy ?? deployment.createdBy ?? 'deployment-orchestrator',
      deploymentId: deployment.deploymentId,
      deploymentStage: deployment.currentStage ?? 'SQS',
      liveDomain: deployment.domain,
      distributionId: deployment.managedResources.cloudFrontDistributionId,
      repositoryName: deployment.managedResources.repoName,
    });
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
      case 'GOOGLE_ANALYTICS':
        return this.handleGoogleAnalytics(deployment);
      case 'SEARCH_CONSOLE':
        return this.handleSearchConsole(deployment);
      case 'GOOGLE_ADS':
        return this.handleGoogleAds(deployment);
      case 'CLARITY':
        return this.handleClarity(deployment);
      case 'TRACKING_INJECTION':
        return this.handleTrackingInjection(deployment);
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
      hostedZoneName: result.hostedZoneName,
      hostedZoneCreated: result.hostedZoneCreated,
      expectedNameServers: result.expectedNameServers,
      actualNameServers: result.actualNameServers,
      domainRegistration: result.domainRegistration,
      managedResources: {
        hostedZoneId: result.hostedZoneId,
        hostedZoneName: result.hostedZoneName,
        route53NameServers: result.expectedNameServers,
        actualNameServers: result.actualNameServers,
        domainRegistrationOperationId: result.domainRegistration?.operationId,
        domainRegistrationStatus: result.domainRegistration?.operationStatus,
        domainRegistrationAvailability: result.domainRegistration?.availability,
      } satisfies Partial<ManagedResources>,
    };
  }

  private async handleGitHubProvision(
    deployment: DeploymentRecord,
  ): Promise<Record<string, unknown>> {
    const result = await this.deps.githubProvision({
      customerId: deployment.customerId,
      domain: deployment.domain,
      projectName: deployment.managedResources.repoName || undefined,
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
      if (deployment.managedResources.validationRecordFqdns?.length) {
        return {
          propagationChecked: true,
          skipped: true,
          validationRecordFqdns:
            deployment.managedResources.validationRecordFqdns,
        };
      }

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
      const result = await this.deps.enableCloudFront({
        distributionId: deployment.managedResources.cloudFrontDistributionId,
      });

      const cloudFrontDomainName =
        result.domainName || deployment.managedResources.cloudFrontDomainName;

      return {
        cloudFrontDistributionId: result.distributionId,
        cloudFrontDomainName,
        enabled: true,
        managedResources: {
          cloudFrontDistributionId: result.distributionId,
          cloudFrontDomainName,
        } satisfies Partial<ManagedResources>,
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
      trackingEnvironment: deployment.managedResources.trackingEnvironment,
    });

    return {
      workflowRunId: result.workflowRunId,
      managedResources: {
        workflowRunId: result.workflowRunId,
      } satisfies Partial<ManagedResources>,
    };
  }

  private async handleGoogleAnalytics(
    deployment: DeploymentRecord,
  ): Promise<Record<string, unknown>> {
    if (deployment.managedResources.googleAnalyticsMeasurementId) {
      return {
        propertyId: deployment.managedResources.googleAnalyticsPropertyId,
        measurementId: deployment.managedResources.googleAnalyticsMeasurementId,
        skipped: true,
      };
    }

    const result = await this.deps.googleAnalytics({
      tenantId: deployment.tenantId,
      customerId: deployment.customerId,
      deploymentId: deployment.deploymentId,
      domain: deployment.domain,
      displayName: deployment.domain,
    });

    if (result.skipped || !result.measurementId) {
      return {
        skipped: true,
        reason: result.reason ?? 'Google Analytics provisioning skipped',
      };
    }

    return {
      propertyId: result.propertyId,
      dataStreamId: result.dataStreamId,
      measurementId: result.measurementId,
      managedResources: {
        analyticsIntegrationId: deployment.customerId,
        googleAnalyticsPropertyId: result.propertyId,
        googleAnalyticsDataStreamId: result.dataStreamId,
        googleAnalyticsMeasurementId: result.measurementId,
        trackingEnvironment: {
          ...(deployment.managedResources.trackingEnvironment ?? {}),
          VITE_GA_MEASUREMENT_ID: result.measurementId,
          NEXT_PUBLIC_GA_MEASUREMENT_ID: result.measurementId,
        },
      } satisfies Partial<ManagedResources>,
    };
  }

  private async handleSearchConsole(
    deployment: DeploymentRecord,
  ): Promise<Record<string, unknown>> {
    if (deployment.managedResources.searchConsoleVerified) {
      return {
        propertyId: deployment.managedResources.searchConsolePropertyId,
        verified: true,
        skipped: true,
      };
    }

    if (!deployment.managedResources.hostedZoneId) {
      throw new Error('Missing hostedZoneId before SEARCH_CONSOLE');
    }

    const result = await this.deps.searchConsole({
      tenantId: deployment.tenantId,
      customerId: deployment.customerId,
      deploymentId: deployment.deploymentId,
      domain: deployment.domain,
      displayName: deployment.domain,
      hostedZoneId: deployment.managedResources.hostedZoneId,
    });

    if (result.skipped || !result.verified) {
      return {
        skipped: true,
        verified: false,
        reason: result.reason ?? 'Search Console provisioning skipped',
      };
    }

    return {
      propertyId: result.propertyId,
      verified: result.verified,
      verificationRecordName: result.verificationRecordName,
      managedResources: {
        analyticsIntegrationId: deployment.customerId,
        searchConsolePropertyId: result.propertyId,
        searchConsoleVerified: result.verified,
        searchConsoleVerificationRecord: result.verificationRecordName,
      } satisfies Partial<ManagedResources>,
    };
  }

  private async handleGoogleAds(
    deployment: DeploymentRecord,
  ): Promise<Record<string, unknown>> {
    if (
      deployment.managedResources.googleAdsCustomerId &&
      deployment.managedResources.googleAdsConversions?.length
    ) {
      return {
        customerId: deployment.managedResources.googleAdsCustomerId,
        conversionId: deployment.managedResources.googleAdsConversionId,
        conversions: deployment.managedResources.googleAdsConversions,
        skipped: true,
      };
    }

    const result = await this.deps.googleAds({
      tenantId: deployment.tenantId,
      customerId: deployment.customerId,
      deploymentId: deployment.deploymentId,
      domain: deployment.domain,
      displayName: deployment.domain,
    });

    return {
      customerId: result.customerId,
      conversionId: result.conversionId,
      conversions: result.conversions,
      managedResources: {
        analyticsIntegrationId: deployment.customerId,
        googleAdsCustomerId: result.customerId,
        googleAdsConversionId: result.conversionId,
        googleAdsConversions: result.conversions,
      } satisfies Partial<ManagedResources>,
    };
  }

  private async handleClarity(
    deployment: DeploymentRecord,
  ): Promise<Record<string, unknown>> {
    if (
      deployment.managedResources.clarityProjectId ||
      deployment.stageStates.CLARITY?.status === 'SUCCEEDED'
    ) {
      return {
        projectId: deployment.managedResources.clarityProjectId,
        skipped: !deployment.managedResources.clarityProjectId,
        skippedPreviously: true,
      };
    }

    const result = await this.deps.clarity({
      tenantId: deployment.tenantId,
      customerId: deployment.customerId,
      deploymentId: deployment.deploymentId,
      domain: deployment.domain,
      displayName: deployment.domain,
    });

    return {
      projectId: result.projectId,
      skipped: result.skipped,
      trackingEnvironment: result.trackingEnvironment,
      managedResources: {
        analyticsIntegrationId: deployment.customerId,
        clarityProjectId: result.projectId,
        trackingEnvironment: {
          ...(deployment.managedResources.trackingEnvironment ?? {}),
          ...result.trackingEnvironment,
        },
      } satisfies Partial<ManagedResources>,
    };
  }

  private async handleTrackingInjection(
    deployment: DeploymentRecord,
  ): Promise<Record<string, unknown>> {
    const result = await this.deps.trackingInjection({
      tenantId: deployment.tenantId,
      customerId: deployment.customerId,
      deploymentId: deployment.deploymentId,
      domain: deployment.domain,
      displayName: deployment.domain,
    });

    return {
      trackingEnvironment: result.trackingEnvironment,
      managedResources: {
        analyticsIntegrationId: deployment.customerId,
        trackingEnvironment: {
          ...(deployment.managedResources.trackingEnvironment ?? {}),
          ...result.trackingEnvironment,
        },
        trackingInjectionReady: true,
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
