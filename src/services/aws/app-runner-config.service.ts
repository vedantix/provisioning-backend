import {
  AppRunnerClient,
  DescribeServiceCommand,
  StartDeploymentCommand,
  UpdateServiceCommand,
  type SourceConfiguration,
} from '@aws-sdk/client-apprunner';
import { env } from '../../config/env';

type AppRunnerUpdateResult = {
  serviceArn: string;
  updateOperationId?: string;
  deploymentOperationId?: string;
  redeployStarted: boolean;
  warning?: string;
};

function cloneSourceConfiguration(
  sourceConfiguration: SourceConfiguration | undefined,
): SourceConfiguration {
  return JSON.parse(JSON.stringify(sourceConfiguration || {}));
}

export class AppRunnerConfigService {
  constructor(
    private readonly client = new AppRunnerClient({ region: env.awsRegion }),
    private readonly serviceArn = env.appRunnerServiceArn,
  ) {}

  async syncEnvironmentVariables(
    variables: Record<string, string>,
  ): Promise<AppRunnerUpdateResult> {
    if (!this.serviceArn) {
      throw new Error('APP_RUNNER_SERVICE_ARN is not configured');
    }

    const current = await this.client.send(
      new DescribeServiceCommand({
        ServiceArn: this.serviceArn,
      }),
    );

    const sourceConfiguration = cloneSourceConfiguration(
      current.Service?.SourceConfiguration,
    );

    this.applyRuntimeEnvironmentVariables(sourceConfiguration, variables);

    const update = await this.client.send(
      new UpdateServiceCommand({
        ServiceArn: this.serviceArn,
        SourceConfiguration: sourceConfiguration,
      }),
    );

    let deploymentOperationId: string | undefined;
    let warning: string | undefined;

    try {
      const deployment = await this.client.send(
        new StartDeploymentCommand({
          ServiceArn: this.serviceArn,
        }),
      );
      deploymentOperationId = deployment.OperationId;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'StartDeployment failed';
      const isOperationInProgress =
        /operation|deployment|in progress|conflict|pending/i.test(message);

      if (!isOperationInProgress) {
        throw error;
      }

      warning =
        'UpdateService is gestart; StartDeployment kon niet apart starten. ' +
        message;
    }

    return {
      serviceArn: this.serviceArn,
      updateOperationId: update.OperationId,
      deploymentOperationId,
      redeployStarted: true,
      warning,
    };
  }

  private applyRuntimeEnvironmentVariables(
    sourceConfiguration: SourceConfiguration,
    variables: Record<string, string>,
  ): void {
    const imageConfiguration =
      sourceConfiguration.ImageRepository?.ImageConfiguration;
    const codeConfigurationValues =
      sourceConfiguration.CodeRepository?.CodeConfiguration
        ?.CodeConfigurationValues;

    if (imageConfiguration) {
      imageConfiguration.RuntimeEnvironmentVariables = {
        ...(imageConfiguration.RuntimeEnvironmentVariables || {}),
        ...variables,
      };
      return;
    }

    if (codeConfigurationValues) {
      codeConfigurationValues.RuntimeEnvironmentVariables = {
        ...(codeConfigurationValues.RuntimeEnvironmentVariables || {}),
        ...variables,
      };
      return;
    }

    throw new Error(
      'App Runner source configuration has no supported runtime environment variable target',
    );
  }
}
