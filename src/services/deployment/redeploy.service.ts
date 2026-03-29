import crypto from 'node:crypto';
import { dispatchDeploymentWorkflow } from '../github/github.service';
import {
  getDeploymentById,
  putDeployment,
  putJob,
  type DeploymentRecord
} from '../aws/dynamodb.service';
import { queueJob } from '../aws/sqs.service';

type RedeployStage =
  | 'DEPLOYMENT_LOOKUP'
  | 'VALIDATE_DEPLOYMENT'
  | 'GITHUB_DISPATCH'
  | 'DYNAMODB'
  | 'SQS';

type StageStatus = 'PENDING' | 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED';

type RedeployStageRecord = {
  stage: RedeployStage;
  status: StageStatus;
  startedAt: string;
  completedAt?: string;
  error?: string;
  details?: unknown;
};

type RedeployParams = {
  customerId: string;
  deploymentId: string;
};

type RedeployFailure = {
  success: false;
  stage: RedeployStage;
  error: string;
  details?: unknown;
  deploymentId: string;
  jobId: string;
  stages: RedeployStageRecord[];
};

type RedeploySuccess = {
  success: true;
  deploymentId: string;
  jobId: string;
  customerId: string;
  repo: string;
  bucket: string;
  distributionId: string;
  stages: RedeployStageRecord[];
};

export type RedeployResult = RedeployFailure | RedeploySuccess;

type DeploymentWithRepo = DeploymentRecord & {
  repo?: string;
};

type RuntimeState = {
  deploymentId: string;
  jobId: string;
  customerId: string;
  stages: RedeployStageRecord[];
  deployment?: DeploymentWithRepo;
};

function nowIso(): string {
  return new Date().toISOString();
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'Unknown error';
}

function toSerializableError(error: unknown): unknown {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    };
  }

  return error;
}

function createStage(stage: RedeployStage): RedeployStageRecord {
  return {
    stage,
    status: 'IN_PROGRESS',
    startedAt: nowIso()
  };
}

async function runStage<T>(
  state: RuntimeState,
  stage: RedeployStage,
  executor: () => Promise<T>
): Promise<{ ok: true; value: T } | { ok: false; failure: RedeployFailure }> {
  const record = createStage(stage);
  state.stages.push(record);

  try {
    const value = await executor();
    record.status = 'SUCCEEDED';
    record.completedAt = nowIso();
    record.details = value;

    return {
      ok: true,
      value
    };
  } catch (error) {
    record.status = 'FAILED';
    record.completedAt = nowIso();
    record.error = toErrorMessage(error);
    record.details = toSerializableError(error);

    return {
      ok: false,
      failure: {
        success: false,
        stage,
        error: record.error,
        details: record.details,
        deploymentId: state.deploymentId,
        jobId: state.jobId,
        stages: state.stages
      }
    };
  }
}

async function persistFailureState(
  state: RuntimeState,
  failedStage: RedeployStage,
  failure: RedeployFailure
): Promise<void> {
  const timestamp = nowIso();

  try {
    if (state.deployment) {
      await putDeployment({
        ...state.deployment,
        id: state.deployment.id,
        customerId: state.deployment.customerId,
        status: 'FAILED',
        currentStage: failedStage,
        updatedAt: timestamp,
        lastError: failure.error,
        lastErrorDetails: failure.details,
        deploymentEvents: [
          ...((Array.isArray(state.deployment.deploymentEvents)
            ? state.deployment.deploymentEvents
            : []) as unknown[]),
          {
            type: 'REDEPLOY_FAILED',
            failedStage,
            at: timestamp
          }
        ]
      });
    }
  } catch (error) {
    console.error('[REDEPLOY] Failed to persist deployment failure state', {
      deploymentId: state.deploymentId,
      failedStage,
      error: toErrorMessage(error)
    });
  }

  try {
    await putJob({
      id: state.jobId,
      customerId: state.customerId,
      deploymentId: state.deploymentId,
      jobType: 'REDEPLOY',
      status: 'FAILED',
      payload: {
        failedStage
      },
      stages: state.stages,
      lastError: failure.error,
      lastErrorDetails: failure.details,
      createdAt: timestamp,
      updatedAt: timestamp
    });
  } catch (error) {
    console.error('[REDEPLOY] Failed to persist job failure state', {
      jobId: state.jobId,
      failedStage,
      error: toErrorMessage(error)
    });
  }
}

export async function redeploySite(
  params: RedeployParams
): Promise<RedeployResult> {
  const state: RuntimeState = {
    deploymentId: params.deploymentId,
    jobId: crypto.randomUUID(),
    customerId: params.customerId,
    stages: []
  };

  // 1. DEPLOYMENT_LOOKUP
  {
    const result = await runStage(state, 'DEPLOYMENT_LOOKUP', async () => {
      const deployment = (await getDeploymentById(params.deploymentId)) as DeploymentWithRepo | null;

      if (!deployment) {
        throw new Error(`Deployment ${params.deploymentId} not found`);
      }

      if (deployment.customerId !== params.customerId) {
        throw new Error(
          `Deployment ${params.deploymentId} does not belong to customer ${params.customerId}`
        );
      }

      state.deployment = deployment;

      return {
        deploymentId: deployment.id,
        customerId: deployment.customerId,
        repo: deployment.repo ?? null,
        bucketName: deployment.bucketName ?? null,
        cloudfrontDistributionId: deployment.cloudfrontDistributionId ?? null
      };
    });

    if (!result.ok) {
      await persistFailureState(state, 'DEPLOYMENT_LOOKUP', result.failure);
      return result.failure;
    }
  }

  // 2. VALIDATE_DEPLOYMENT
  {
    const result = await runStage(state, 'VALIDATE_DEPLOYMENT', async () => {
      if (!state.deployment) {
        throw new Error('deployment missing before validation');
      }

      if (!state.deployment.repo) {
        throw new Error(`Deployment ${params.deploymentId} has no repo`);
      }

      if (!state.deployment.bucketName) {
        throw new Error(`Deployment ${params.deploymentId} has no bucketName`);
      }

      if (!state.deployment.cloudfrontDistributionId) {
        throw new Error(`Deployment ${params.deploymentId} has no cloudfrontDistributionId`);
      }

      return {
        repo: state.deployment.repo,
        bucket: state.deployment.bucketName,
        distributionId: state.deployment.cloudfrontDistributionId
      };
    });

    if (!result.ok) {
      await persistFailureState(state, 'VALIDATE_DEPLOYMENT', result.failure);
      return result.failure;
    }
  }

  // 3. GITHUB_DISPATCH
  {
    const result = await runStage(state, 'GITHUB_DISPATCH', async () => {
      if (!state.deployment?.repo || !state.deployment.bucketName || !state.deployment.cloudfrontDistributionId) {
        throw new Error('deployment missing repo/bucket/distribution before dispatch');
      }

      const dispatchResult = await dispatchDeploymentWorkflow({
        repo: state.deployment.repo,
        bucket: String(state.deployment.bucketName),
        distributionId: String(state.deployment.cloudfrontDistributionId)
      });

      if (!dispatchResult.success) {
        throw new Error(dispatchResult.error ?? 'Failed to dispatch redeploy workflow');
      }

      return {
        repo: state.deployment.repo,
        bucket: state.deployment.bucketName,
        distributionId: state.deployment.cloudfrontDistributionId
      };
    });

    if (!result.ok) {
      await persistFailureState(state, 'GITHUB_DISPATCH', result.failure);
      return result.failure;
    }
  }

  // 4. DYNAMODB
  {
    const result = await runStage(state, 'DYNAMODB', async () => {
      if (!state.deployment) {
        throw new Error('deployment missing before persistence');
      }

      const timestamp = nowIso();

      await putDeployment({
        ...state.deployment,
        id: state.deployment.id,
        customerId: state.deployment.customerId,
        status: 'QUEUED',
        currentStage: 'DYNAMODB',
        updatedAt: timestamp,
        deploymentEvents: [
          ...((Array.isArray(state.deployment.deploymentEvents)
            ? state.deployment.deploymentEvents
            : []) as unknown[]),
          {
            type: 'REDEPLOY_REQUESTED',
            at: timestamp
          }
        ]
      });

      await putJob({
        id: state.jobId,
        customerId: state.customerId,
        deploymentId: state.deploymentId,
        jobType: 'REDEPLOY',
        status: 'QUEUED',
        payload: {
          repo: state.deployment.repo,
          bucket: state.deployment.bucketName,
          distributionId: state.deployment.cloudfrontDistributionId
        },
        stages: state.stages,
        createdAt: timestamp,
        updatedAt: timestamp
      });

      return {
        deploymentId: state.deploymentId,
        jobId: state.jobId
      };
    });

    if (!result.ok) {
      await persistFailureState(state, 'DYNAMODB', result.failure);
      return result.failure;
    }
  }

  // 5. SQS
  {
    const result = await runStage(state, 'SQS', async () => {
      await queueJob({
        jobId: state.jobId,
        deploymentId: state.deploymentId,
        customerId: state.customerId,
        type: 'REDEPLOY'
      });

      return {
        queued: true,
        jobId: state.jobId
      };
    });

    if (!result.ok) {
      await persistFailureState(state, 'SQS', result.failure);
      return result.failure;
    }
  }

  return {
    success: true,
    deploymentId: state.deploymentId,
    jobId: state.jobId,
    customerId: state.customerId,
    repo: String(state.deployment!.repo),
    bucket: String(state.deployment!.bucketName),
    distributionId: String(state.deployment!.cloudfrontDistributionId),
    stages: state.stages
  };
}