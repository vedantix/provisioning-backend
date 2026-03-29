import crypto from 'node:crypto';
import {
  getDeploymentById,
  putDeployment,
  putJob,
  type DeploymentRecord
} from '../aws/dynamodb.service';
import { queueJob } from '../aws/sqs.service';
import { dispatchRollbackWorkflow } from '../github/github.service';

type RollbackStage =
  | 'DEPLOYMENT_LOOKUP'
  | 'VALIDATE_ROLLBACK'
  | 'GITHUB_DISPATCH'
  | 'DYNAMODB'
  | 'SQS';

type StageStatus = 'PENDING' | 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED';

type RollbackStageRecord = {
  stage: RollbackStage;
  status: StageStatus;
  startedAt: string;
  completedAt?: string;
  error?: string;
  details?: unknown;
};

type RollbackParams = {
  customerId: string;
  deploymentId: string;
  targetRef: string;
};

type RollbackFailure = {
  success: false;
  stage: RollbackStage;
  error: string;
  details?: unknown;
  deploymentId: string;
  jobId: string;
  stages: RollbackStageRecord[];
};

type RollbackSuccess = {
  success: true;
  deploymentId: string;
  jobId: string;
  customerId: string;
  targetRef: string;
  repo: string;
  bucket: string;
  distributionId: string;
  stages: RollbackStageRecord[];
};

export type RollbackResult = RollbackFailure | RollbackSuccess;

type DeploymentWithRepo = DeploymentRecord & {
  repo?: string;
};

type RuntimeState = {
  deploymentId: string;
  jobId: string;
  customerId: string;
  targetRef: string;
  stages: RollbackStageRecord[];
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

function createStage(stage: RollbackStage): RollbackStageRecord {
  return {
    stage,
    status: 'IN_PROGRESS',
    startedAt: nowIso()
  };
}

function validateTargetRef(targetRef: string): void {
  const normalized = targetRef.trim();

  if (!normalized) {
    throw new Error('targetRef is required');
  }

  if (normalized.length < 3 || normalized.length > 200) {
    throw new Error('targetRef length is invalid');
  }

  if (!/^[a-zA-Z0-9._/\-]+$/.test(normalized)) {
    throw new Error('targetRef contains unsupported characters');
  }
}

async function runStage<T>(
  state: RuntimeState,
  stage: RollbackStage,
  executor: () => Promise<T>
): Promise<{ ok: true; value: T } | { ok: false; failure: RollbackFailure }> {
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
  failedStage: RollbackStage,
  failure: RollbackFailure
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
            type: 'ROLLBACK_FAILED',
            targetRef: state.targetRef,
            failedStage,
            at: timestamp
          }
        ]
      });
    }
  } catch (error) {
    console.error('[ROLLBACK] Failed to persist deployment failure state', {
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
      jobType: 'ROLLBACK',
      status: 'FAILED',
      payload: {
        targetRef: state.targetRef,
        failedStage
      },
      stages: state.stages,
      lastError: failure.error,
      lastErrorDetails: failure.details,
      createdAt: timestamp,
      updatedAt: timestamp
    });
  } catch (error) {
    console.error('[ROLLBACK] Failed to persist job failure state', {
      jobId: state.jobId,
      failedStage,
      error: toErrorMessage(error)
    });
  }
}

export async function rollbackSite(
  params: RollbackParams
): Promise<RollbackResult> {
  const state: RuntimeState = {
    deploymentId: params.deploymentId,
    jobId: crypto.randomUUID(),
    customerId: params.customerId,
    targetRef: params.targetRef.trim(),
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

  // 2. VALIDATE_ROLLBACK
  {
    const result = await runStage(state, 'VALIDATE_ROLLBACK', async () => {
      if (!state.deployment) {
        throw new Error('deployment missing before rollback validation');
      }

      validateTargetRef(state.targetRef);

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
        targetRef: state.targetRef,
        repo: state.deployment.repo,
        bucket: state.deployment.bucketName,
        distributionId: state.deployment.cloudfrontDistributionId
      };
    });

    if (!result.ok) {
      await persistFailureState(state, 'VALIDATE_ROLLBACK', result.failure);
      return result.failure;
    }
  }

  // 3. GITHUB_DISPATCH
  {
    const result = await runStage(state, 'GITHUB_DISPATCH', async () => {
      if (!state.deployment?.repo || !state.deployment.bucketName || !state.deployment.cloudfrontDistributionId) {
        throw new Error('deployment missing repo/bucket/distribution before rollback dispatch');
      }

      const dispatchResult = await dispatchRollbackWorkflow({
        repo: state.deployment.repo,
        bucket: String(state.deployment.bucketName),
        distributionId: String(state.deployment.cloudfrontDistributionId),
        targetRef: state.targetRef
      });

      if (!dispatchResult.success) {
        throw new Error(dispatchResult.error ?? 'Failed to dispatch rollback workflow');
      }

      return {
        repo: state.deployment.repo,
        bucket: state.deployment.bucketName,
        distributionId: state.deployment.cloudfrontDistributionId,
        targetRef: state.targetRef
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
            type: 'ROLLBACK_REQUESTED',
            targetRef: state.targetRef,
            at: timestamp
          }
        ]
      });

      await putJob({
        id: state.jobId,
        customerId: state.customerId,
        deploymentId: state.deploymentId,
        jobType: 'ROLLBACK',
        status: 'QUEUED',
        payload: {
          repo: state.deployment.repo,
          bucket: state.deployment.bucketName,
          distributionId: state.deployment.cloudfrontDistributionId,
          targetRef: state.targetRef
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
        type: 'ROLLBACK'
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
    targetRef: state.targetRef,
    repo: String(state.deployment!.repo),
    bucket: String(state.deployment!.bucketName),
    distributionId: String(state.deployment!.cloudfrontDistributionId),
    stages: state.stages
  };
}