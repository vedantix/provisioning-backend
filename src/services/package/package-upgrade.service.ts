import crypto from 'node:crypto';
import { resolvePlan } from '../plan/plan-resolver.service';
import { dispatchDeploymentWorkflow } from '../github/github.service';
import {
  getDeploymentById,
  putDeployment,
  putJob,
  type DeploymentRecord
} from '../aws/dynamodb.service';
import { queueJob } from '../aws/sqs.service';
import { PackageCode, AddOnInput } from '../../types/package.types';

type PackageUpgradeStage =
  | 'DEPLOYMENT_LOOKUP'
  | 'PLAN_RESOLVE'
  | 'VALIDATE_UPGRADE'
  | 'GITHUB_SYNC'
  | 'DYNAMODB'
  | 'SQS';

type StageStatus = 'PENDING' | 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED';

type PackageUpgradeStageRecord = {
  stage: PackageUpgradeStage;
  status: StageStatus;
  startedAt: string;
  completedAt?: string;
  error?: string;
  details?: unknown;
};

type PackageUpgradeFailure = {
  success: false;
  stage: PackageUpgradeStage;
  error: string;
  details?: unknown;
  deploymentId: string;
  jobId: string;
  stages: PackageUpgradeStageRecord[];
};

type PackageUpgradeSuccess = {
  success: true;
  deploymentId: string;
  jobId: string;
  customerId: string;
  previousPackageCode: PackageCode;
  targetPackageCode: PackageCode;
  addOns: AddOnInput[];
  plan: unknown;
  stages: PackageUpgradeStageRecord[];
};

export type PackageUpgradeResult = PackageUpgradeSuccess | PackageUpgradeFailure;

type UpgradeParams = {
  customerId: string;
  deploymentId: string;
  targetPackageCode: PackageCode;
  addOns: AddOnInput[];
};

type DeploymentWithPackage = DeploymentRecord & {
  currentPackageCode?: PackageCode;
  repo?: string;
};

type RuntimeState = {
  deploymentId: string;
  jobId: string;
  customerId: string;
  targetPackageCode: PackageCode;
  addOns: AddOnInput[];
  stages: PackageUpgradeStageRecord[];
  deployment?: DeploymentWithPackage;
  previousPackageCode?: PackageCode;
  plan?: unknown;
};

const PACKAGE_ORDER: Record<PackageCode, number> = {
  STARTER: 1,
  GROWTH: 2,
  PRO: 3,
  CUSTOM: 4
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

function createStage(stage: PackageUpgradeStage): PackageUpgradeStageRecord {
  return {
    stage,
    status: 'IN_PROGRESS',
    startedAt: nowIso()
  };
}

function isPackageCode(value: unknown): value is PackageCode {
  return value === 'STARTER' || value === 'GROWTH' || value === 'PRO' || value === 'CUSTOM';
}

function resolveCurrentPackageCode(deployment: DeploymentRecord): PackageCode {
  const candidate =
    deployment.currentPackageCode ??
    (typeof deployment.planSnapshot === 'object' &&
    deployment.planSnapshot !== null &&
    'packageCode' in deployment.planSnapshot
      ? (deployment.planSnapshot as { packageCode?: unknown }).packageCode
      : undefined);

  if (!isPackageCode(candidate)) {
    throw new Error(`Deployment ${deployment.id} has no valid currentPackageCode`);
  }

  return candidate;
}

function validateUpgradeDirection(current: PackageCode, target: PackageCode): void {
  const currentRank = PACKAGE_ORDER[current];
  const targetRank = PACKAGE_ORDER[target];

  if (!currentRank || !targetRank) {
    throw new Error(`Unsupported package transition: ${current} -> ${target}`);
  }

  if (targetRank < currentRank) {
    throw new Error(`Downgrade is not allowed in package-upgrades flow (${current} -> ${target})`);
  }

  if (targetRank === currentRank) {
    throw new Error(`Deployment is already on package ${target}`);
  }
}

async function runStage<T>(
  state: RuntimeState,
  stage: PackageUpgradeStage,
  executor: () => Promise<T>
): Promise<{ ok: true; value: T } | { ok: false; failure: PackageUpgradeFailure }> {
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
  failedStage: PackageUpgradeStage,
  failure: PackageUpgradeFailure
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
        currentPackageCode: state.previousPackageCode ?? state.deployment.currentPackageCode,
        planSnapshot: state.plan ?? state.deployment.planSnapshot,
        updatedAt: timestamp,
        lastError: failure.error,
        lastErrorDetails: failure.details,
        packageEvents: [
          ...((Array.isArray(state.deployment.packageEvents)
            ? state.deployment.packageEvents
            : []) as unknown[]),
          {
            type: 'PACKAGE_UPGRADE_FAILED',
            from: state.previousPackageCode,
            to: state.targetPackageCode,
            addOns: state.addOns,
            failedStage,
            at: timestamp
          }
        ]
      });
    }
  } catch (error) {
    console.error('[PACKAGE_UPGRADE] Failed to persist deployment failure state', {
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
      jobType: 'PACKAGE_UPGRADE',
      status: 'FAILED',
      payload: {
        targetPackageCode: state.targetPackageCode,
        addOns: state.addOns,
        failedStage
      },
      stages: state.stages,
      lastError: failure.error,
      lastErrorDetails: failure.details,
      createdAt: timestamp,
      updatedAt: timestamp
    });
  } catch (error) {
    console.error('[PACKAGE_UPGRADE] Failed to persist job failure state', {
      jobId: state.jobId,
      failedStage,
      error: toErrorMessage(error)
    });
  }
}

export async function upgradePackage(params: UpgradeParams): Promise<PackageUpgradeResult> {
  const state: RuntimeState = {
    deploymentId: params.deploymentId,
    jobId: crypto.randomUUID(),
    customerId: params.customerId,
    targetPackageCode: params.targetPackageCode,
    addOns: params.addOns,
    stages: []
  };

  // 1. DEPLOYMENT_LOOKUP
  {
    const result = await runStage(state, 'DEPLOYMENT_LOOKUP', async () => {
      const deployment = (await getDeploymentById(params.deploymentId)) as DeploymentWithPackage | null;

      if (!deployment) {
        throw new Error(`Deployment ${params.deploymentId} not found`);
      }

      if (deployment.customerId !== params.customerId) {
        throw new Error(
          `Deployment ${params.deploymentId} does not belong to customer ${params.customerId}`
        );
      }

      state.deployment = deployment;
      state.previousPackageCode = resolveCurrentPackageCode(deployment);

      return {
        deploymentId: deployment.id,
        customerId: deployment.customerId,
        currentPackageCode: state.previousPackageCode,
        repo: deployment.repo ?? null
      };
    });

    if (!result.ok) {
      await persistFailureState(state, 'DEPLOYMENT_LOOKUP', result.failure);
      return result.failure;
    }
  }

  // 2. PLAN_RESOLVE
  {
    const result = await runStage(state, 'PLAN_RESOLVE', async () => {
      const plan = resolvePlan(params.targetPackageCode, params.addOns);
      state.plan = plan;

      return {
        targetPackageCode: params.targetPackageCode,
        addOns: params.addOns,
        plan
      };
    });

    if (!result.ok) {
      await persistFailureState(state, 'PLAN_RESOLVE', result.failure);
      return result.failure;
    }
  }

  // 3. VALIDATE_UPGRADE
  {
    const result = await runStage(state, 'VALIDATE_UPGRADE', async () => {
      if (!state.previousPackageCode) {
        throw new Error('previousPackageCode missing before validation');
      }

      validateUpgradeDirection(state.previousPackageCode, params.targetPackageCode);

      return {
        from: state.previousPackageCode,
        to: params.targetPackageCode
      };
    });

    if (!result.ok) {
      await persistFailureState(state, 'VALIDATE_UPGRADE', result.failure);
      return result.failure;
    }
  }

  // 4. GITHUB_SYNC
  {
    const result = await runStage(state, 'GITHUB_SYNC', async () => {
      if (!state.deployment) {
        throw new Error('deployment missing before GitHub sync');
      }

      if (!state.deployment.repo) {
        return {
          skipped: true,
          reason: 'No repo linked to deployment'
        };
      }

      const dispatchResult = await dispatchDeploymentWorkflow({
        repo: state.deployment.repo,
        bucket: String(state.deployment.bucketName ?? ''),
        distributionId: String(state.deployment.cloudfrontDistributionId ?? '')
      });

      if (!dispatchResult.success) {
        throw new Error(dispatchResult.error ?? 'Failed to dispatch deployment workflow');
      }

      return {
        skipped: false,
        repo: state.deployment.repo,
        bucket: state.deployment.bucketName,
        distributionId: state.deployment.cloudfrontDistributionId
      };
    });

    if (!result.ok) {
      await persistFailureState(state, 'GITHUB_SYNC', result.failure);
      return result.failure;
    }
  }

  // 5. DYNAMODB
  {
    const result = await runStage(state, 'DYNAMODB', async () => {
      if (!state.deployment) {
        throw new Error('deployment missing before persistence');
      }

      if (!state.previousPackageCode) {
        throw new Error('previousPackageCode missing before persistence');
      }

      const timestamp = nowIso();

      await putDeployment({
        ...state.deployment,
        id: state.deployment.id,
        customerId: state.deployment.customerId,
        status: 'QUEUED',
        currentStage: 'DYNAMODB',
        currentPackageCode: params.targetPackageCode,
        addOns: params.addOns,
        planSnapshot: state.plan,
        updatedAt: timestamp,
        packageEvents: [
          ...((Array.isArray(state.deployment.packageEvents)
            ? state.deployment.packageEvents
            : []) as unknown[]),
          {
            type: 'PACKAGE_UPGRADE_REQUESTED',
            from: state.previousPackageCode,
            to: params.targetPackageCode,
            addOns: params.addOns,
            at: timestamp
          }
        ]
      });

      await putJob({
        id: state.jobId,
        customerId: params.customerId,
        deploymentId: params.deploymentId,
        jobType: 'PACKAGE_UPGRADE',
        status: 'QUEUED',
        payload: {
          previousPackageCode: state.previousPackageCode,
          targetPackageCode: params.targetPackageCode,
          addOns: params.addOns
        },
        stages: state.stages,
        createdAt: timestamp,
        updatedAt: timestamp
      });

      return {
        deploymentId: params.deploymentId,
        jobId: state.jobId
      };
    });

    if (!result.ok) {
      await persistFailureState(state, 'DYNAMODB', result.failure);
      return result.failure;
    }
  }

  // 6. SQS
  {
    const result = await runStage(state, 'SQS', async () => {
      await queueJob({
        jobId: state.jobId,
        deploymentId: params.deploymentId,
        customerId: params.customerId,
        type: 'PACKAGE_UPGRADE'
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
    deploymentId: params.deploymentId,
    jobId: state.jobId,
    customerId: params.customerId,
    previousPackageCode: state.previousPackageCode!,
    targetPackageCode: params.targetPackageCode,
    addOns: params.addOns,
    plan: state.plan,
    stages: state.stages
  };
}