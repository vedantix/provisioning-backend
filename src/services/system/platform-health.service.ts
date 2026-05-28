import { GetQueueAttributesCommand, SQSClient } from '@aws-sdk/client-sqs';
import { env } from '../../config/env';
import { DeploymentsRepository } from '../../repositories/deployments.repository';
import { AnalyticsIntegrationsRepository } from '../../repositories/analytics-integrations.repository';
import { DeadLetterRepository } from '../../repositories/dead-letter.repository';
import { EnvironmentValidationService } from '../analytics/environment-validation.service';
import { GoogleServiceAccountAuth } from '../analytics/google-auth.service';

const GOOGLE_HEALTH_SCOPES = [
  'https://www.googleapis.com/auth/analytics.edit',
  'https://www.googleapis.com/auth/webmasters',
  'https://www.googleapis.com/auth/siteverification',
  'https://www.googleapis.com/auth/adwords',
];

export class PlatformHealthService {
  constructor(
    private readonly googleAuth = new GoogleServiceAccountAuth(),
    private readonly environmentValidationService = new EnvironmentValidationService(),
    private readonly deploymentsRepository = new DeploymentsRepository(),
    private readonly analyticsRepository = new AnalyticsIntegrationsRepository(),
    private readonly deadLetterRepository = new DeadLetterRepository(),
    private readonly sqs = new SQSClient({ region: env.awsRegion }),
  ) {}

  async google(): Promise<Record<string, unknown>> {
    const environment = this.environmentValidationService.validateMarketingStackEnvironment();
    const token = await this.googleAuth.validateToken(GOOGLE_HEALTH_SCOPES);

    return {
      status: environment.ok && token.ok ? 'ok' : 'unhealthy',
      environment,
      token,
      checkedAt: new Date().toISOString(),
    };
  }

  async deployments(): Promise<Record<string, unknown>> {
    const cleanupCandidates = await this.deploymentsRepository.listCleanupCandidates({
      limit: 25,
    });

    return {
      status: cleanupCandidates.length === 0 ? 'ok' : 'attention_required',
      failedOrDeleting: cleanupCandidates.length,
      sample: cleanupCandidates.slice(0, 10).map((deployment) => ({
        deploymentId: deployment.deploymentId,
        customerId: deployment.customerId,
        domain: deployment.domain,
        status: deployment.status,
        currentStage: deployment.currentStage,
        failureStage: deployment.failureStage,
        updatedAt: deployment.updatedAt,
      })),
      checkedAt: new Date().toISOString(),
    };
  }

  async queues(): Promise<Record<string, unknown>> {
    const attributes = await this.sqs.send(
      new GetQueueAttributesCommand({
        QueueUrl: env.sqsQueueUrl,
        AttributeNames: [
          'ApproximateNumberOfMessages',
          'ApproximateNumberOfMessagesNotVisible',
          'ApproximateNumberOfMessagesDelayed',
          'RedrivePolicy',
        ],
      }),
    );
    const deadLettersReadable = await this.deadLetterRepository.healthScan();

    return {
      status: 'ok',
      queueUrl: env.sqsQueueUrl,
      approximateMessages: Number(attributes.Attributes?.ApproximateNumberOfMessages ?? 0),
      approximateInFlight: Number(attributes.Attributes?.ApproximateNumberOfMessagesNotVisible ?? 0),
      approximateDelayed: Number(attributes.Attributes?.ApproximateNumberOfMessagesDelayed ?? 0),
      redrivePolicyConfigured: Boolean(attributes.Attributes?.RedrivePolicy),
      deadLetterTableReadable: true,
      deadLettersReadable,
      checkedAt: new Date().toISOString(),
    };
  }

  async provisioning(): Promise<Record<string, unknown>> {
    const analyticsRowsReadable = await this.analyticsRepository.healthScan();
    const google = await this.google();

    return {
      status: google.status === 'ok' ? 'ok' : 'unhealthy',
      analyticsRowsReadable,
      google,
      checkedAt: new Date().toISOString(),
    };
  }
}
