import crypto from "node:crypto";
import { resolvePlan } from "../plan/plan-resolver.service";
import { dispatchDeploymentWorkflow } from "../github/github.service";
import {
  getDeploymentById,
  putJob,
  updateDeployment,
  updateJob,
  type DeploymentRecord,
} from "../aws/dynamodb.service";
import { queueJob } from "../aws/sqs.service";
import {
  PackageCode,
  AddOnInput,
  ResolvedPlan,
} from "../../types/package.types";

type PackageUpgradeStage =
  | "DEPLOYMENT_LOOKUP"
  | "PLAN_RESOLVE"
  | "VALIDATE_UPGRADE"
  | "GITHUB_SYNC"
  | "DYNAMODB"
  | "SQS";

type StageStatus = "PENDING" | "IN_PROGRESS" | "SUCCEEDED" | "FAILED";

type JobStatus =
  | "QUEUED"
  | "RUNNING"
  | "FAILED"
  | "SUCCEEDED"
  | "DELETED";

type DeploymentStatus =
  | "QUEUED"
  | "RUNNING"
  | "FAILED"
  | "SUCCEEDED"
  | "DELETED";

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
  plan: ResolvedPlan;
  stages: PackageUpgradeStageRecord[];
};

export type PackageUpgradeResult =
  | PackageUpgradeSuccess
  | PackageUpgradeFailure;

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
  plan?: ResolvedPlan;
};

type PackageEvent = {
  type:
    | "PACKAGE_UPGRADE_STARTED"
    | "PACKAGE_STAGE_STARTED"
    | "PACKAGE_STAGE_COMPLETED"
    | "PACKAGE_UPGRADE_FAILED"
    | "PACKAGE_UPGRADE_REQUESTED";
  from?: PackageCode;
  to?: PackageCode;
  addOns?: AddOnInput[];
  failedStage?: PackageUpgradeStage;
  stage?: PackageUpgradeStage;
  at: string;
  details?: Record<string, unknown>;
};

const PACKAGE_ORDER: Record<PackageCode, number> = {
  STARTER: 1,
  GROWTH: 2,
  PRO: 3,
  CUSTOM: 4,
};

function nowIso(): string {
  return new Date().toISOString();
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Unknown error";
}

function toSerializableError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    message: String(error),
  };
}

function createStage(stage: PackageUpgradeStage): PackageUpgradeStageRecord {
  return {
    stage,
    status: "IN_PROGRESS",
    startedAt: nowIso(),
  };
}

function isPackageCode(value: unknown): value is PackageCode {
  return (
    value === "STARTER" ||
    value === "GROWTH" ||
    value === "PRO" ||
    value === "CUSTOM"
  );
}

function resolveCurrentPackageCode(deployment: DeploymentRecord): PackageCode {
  const candidate =
    deployment.currentPackageCode ??
    (typeof deployment.planSnapshot === "object" &&
    deployment.planSnapshot !== null &&
    "packageCode" in deployment.planSnapshot
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
    throw new Error(
      `Downgrade is not allowed in package-upgrades flow (${current} -> ${target})`
    );
  }

  if (targetRank === currentRank) {
    throw new Error(`Deployment is already on package ${target}`);
  }
}

async function appendPackageEvent(params: {
  deploymentId: string;
  event: PackageEvent;
}): Promise<void> {
  await updateDeployment({
    deploymentId: params.deploymentId,
    appendToLists: {
      packageEvents: [params.event],
    },
  });
}

async function markJobRunning(params: {
  jobId: string;
  stage: PackageUpgradeStage;
  extra?: Record<string, unknown>;
}): Promise<void> {
  await updateJob({
    jobId: params.jobId,
    set: {
      status: "RUNNING" as JobStatus,
      currentStage: params.stage,
      ...params.extra,
    },
  });
}

async function markJobFailed(params: {
  jobId: string;
  stage: PackageUpgradeStage;
  error: unknown;
  extra?: Record<string, unknown>;
}): Promise<void> {
  const errorMessage = toErrorMessage(params.error);
  const errorDetails = toSerializableError(params.error);

  await updateJob({
    jobId: params.jobId,
    set: {
      status: "FAILED" as JobStatus,
      currentStage: params.stage,
      lastError: errorMessage,
      lastErrorDetails: errorDetails,
      ...params.extra,
    },
  });
}

async function markJobSucceeded(params: {
  jobId: string;
  extra?: Record<string, unknown>;
}): Promise<void> {
  await updateJob({
    jobId: params.jobId,
    set: {
      status: "SUCCEEDED" as JobStatus,
      completedAt: nowIso(),
      ...params.extra,
    },
  });
}

async function runStage<T>(
  state: RuntimeState,
  stage: PackageUpgradeStage,
  executor: () => Promise<T>,
  hooks?: {
    onStart?: () => Promise<void>;
    onSuccess?: (value: T) => Promise<void>;
    onFailure?: (error: unknown) => Promise<void>;
  }
): Promise<{ ok: true; value: T } | { ok: false; failure: PackageUpgradeFailure }> {
  const record = createStage(stage);
  state.stages.push(record);

  try {
    await hooks?.onStart?.();

    const value = await executor();

    record.status = "SUCCEEDED";
    record.completedAt = nowIso();
    record.details = value;

    await hooks?.onSuccess?.(value);

    return {
      ok: true,
      value,
    };
  } catch (error) {
    record.status = "FAILED";
    record.completedAt = nowIso();
    record.error = toErrorMessage(error);
    record.details = toSerializableError(error);

    await hooks?.onFailure?.(error);

    return {
      ok: false,
      failure: {
        success: false,
        stage,
        error: record.error,
        details: record.details,
        deploymentId: state.deploymentId,
        jobId: state.jobId,
        stages: state.stages,
      },
    };
  }
}

export async function upgradePackage(
  params: UpgradeParams
): Promise<PackageUpgradeResult> {
  const startedAt = nowIso();

  const state: RuntimeState = {
    deploymentId: params.deploymentId,
    jobId: `job_${crypto.randomUUID()}`,
    customerId: params.customerId,
    targetPackageCode: params.targetPackageCode,
    addOns: params.addOns,
    stages: [],
  };

  await putJob({
    id: state.jobId,
    jobId: state.jobId,
    customerId: params.customerId,
    deploymentId: params.deploymentId,
    jobType: "PACKAGE_UPGRADE",
    status: "QUEUED",
    currentStage: "DEPLOYMENT_LOOKUP",
    createdAt: startedAt,
    updatedAt: startedAt,
    payload: {
      targetPackageCode: params.targetPackageCode,
      addOns: params.addOns,
    },
  });

  await updateDeployment({
    deploymentId: params.deploymentId,
    set: {
      status: "RUNNING" as DeploymentStatus,
      currentStage: "DEPLOYMENT_LOOKUP",
      updatedAt: startedAt,
    },
    appendToLists: {
      packageEvents: [
        {
          type: "PACKAGE_UPGRADE_STARTED",
          to: params.targetPackageCode,
          addOns: params.addOns,
          stage: "DEPLOYMENT_LOOKUP",
          at: startedAt,
        } as PackageEvent,
      ],
    },
  });

  // 1. DEPLOYMENT_LOOKUP
  {
    const result = await runStage(
      state,
      "DEPLOYMENT_LOOKUP",
      async () => {
        const deployment = (await getDeploymentById(
          params.deploymentId
        )) as DeploymentWithPackage | null;

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
          repo: deployment.repo ?? null,
        };
      },
      {
        onStart: async () => {
          await Promise.all([
            markJobRunning({
              jobId: state.jobId,
              stage: "DEPLOYMENT_LOOKUP",
            }),
            appendPackageEvent({
              deploymentId: state.deploymentId,
              event: {
                type: "PACKAGE_STAGE_STARTED",
                stage: "DEPLOYMENT_LOOKUP",
                at: nowIso(),
                to: params.targetPackageCode,
              },
            }),
          ]);
        },
        onSuccess: async (value) => {
          await updateDeployment({
            deploymentId: state.deploymentId,
            set: {
              currentStage: "DEPLOYMENT_LOOKUP",
              packageUpgradeLookup: value,
            },
            appendToLists: {
              packageEvents: [
                {
                  type: "PACKAGE_STAGE_COMPLETED",
                  stage: "DEPLOYMENT_LOOKUP",
                  from: state.previousPackageCode,
                  to: params.targetPackageCode,
                  at: nowIso(),
                } as PackageEvent,
              ],
            },
          });
        },
        onFailure: async (error) => {
          await Promise.all([
            markJobFailed({
              jobId: state.jobId,
              stage: "DEPLOYMENT_LOOKUP",
              error,
            }),
            updateDeployment({
              deploymentId: state.deploymentId,
              set: {
                status: "FAILED" as DeploymentStatus,
                currentStage: "DEPLOYMENT_LOOKUP",
                lastError: toErrorMessage(error),
                lastErrorDetails: toSerializableError(error),
              },
              appendToLists: {
                packageEvents: [
                  {
                    type: "PACKAGE_UPGRADE_FAILED",
                    from: state.previousPackageCode,
                    to: params.targetPackageCode,
                    addOns: params.addOns,
                    failedStage: "DEPLOYMENT_LOOKUP",
                    stage: "DEPLOYMENT_LOOKUP",
                    at: nowIso(),
                    details: toSerializableError(error),
                  } as PackageEvent,
                ],
              },
            }),
          ]);
        },
      }
    );

    if (!result.ok) {
      return result.failure;
    }
  }

  // 2. PLAN_RESOLVE
  {
    const result = await runStage(
      state,
      "PLAN_RESOLVE",
      async () => {
        const plan = resolvePlan(params.targetPackageCode, params.addOns);
        state.plan = plan;

        return {
          targetPackageCode: params.targetPackageCode,
          addOns: params.addOns,
          plan,
        };
      },
      {
        onStart: async () => {
          await Promise.all([
            markJobRunning({
              jobId: state.jobId,
              stage: "PLAN_RESOLVE",
            }),
            updateDeployment({
              deploymentId: state.deploymentId,
              set: {
                currentStage: "PLAN_RESOLVE",
              },
              appendToLists: {
                packageEvents: [
                  {
                    type: "PACKAGE_STAGE_STARTED",
                    stage: "PLAN_RESOLVE",
                    from: state.previousPackageCode,
                    to: params.targetPackageCode,
                    at: nowIso(),
                  } as PackageEvent,
                ],
              },
            }),
          ]);
        },
        onSuccess: async (value) => {
          await updateDeployment({
            deploymentId: state.deploymentId,
            set: {
              currentStage: "PLAN_RESOLVE",
              pendingPlanSnapshot: value.plan,
            },
            appendToLists: {
              packageEvents: [
                {
                  type: "PACKAGE_STAGE_COMPLETED",
                  stage: "PLAN_RESOLVE",
                  from: state.previousPackageCode,
                  to: params.targetPackageCode,
                  at: nowIso(),
                } as PackageEvent,
              ],
            },
          });
        },
        onFailure: async (error) => {
          await Promise.all([
            markJobFailed({
              jobId: state.jobId,
              stage: "PLAN_RESOLVE",
              error,
            }),
            updateDeployment({
              deploymentId: state.deploymentId,
              set: {
                status: "FAILED" as DeploymentStatus,
                currentStage: "PLAN_RESOLVE",
                lastError: toErrorMessage(error),
                lastErrorDetails: toSerializableError(error),
              },
              appendToLists: {
                packageEvents: [
                  {
                    type: "PACKAGE_UPGRADE_FAILED",
                    from: state.previousPackageCode,
                    to: params.targetPackageCode,
                    addOns: params.addOns,
                    failedStage: "PLAN_RESOLVE",
                    stage: "PLAN_RESOLVE",
                    at: nowIso(),
                    details: toSerializableError(error),
                  } as PackageEvent,
                ],
              },
            }),
          ]);
        },
      }
    );

    if (!result.ok) {
      return result.failure;
    }
  }

  // 3. VALIDATE_UPGRADE
  {
    const result = await runStage(
      state,
      "VALIDATE_UPGRADE",
      async () => {
        if (!state.previousPackageCode) {
          throw new Error("previousPackageCode missing before validation");
        }

        validateUpgradeDirection(
          state.previousPackageCode,
          params.targetPackageCode
        );

        return {
          from: state.previousPackageCode,
          to: params.targetPackageCode,
        };
      },
      {
        onStart: async () => {
          await Promise.all([
            markJobRunning({
              jobId: state.jobId,
              stage: "VALIDATE_UPGRADE",
            }),
            updateDeployment({
              deploymentId: state.deploymentId,
              set: {
                currentStage: "VALIDATE_UPGRADE",
              },
              appendToLists: {
                packageEvents: [
                  {
                    type: "PACKAGE_STAGE_STARTED",
                    stage: "VALIDATE_UPGRADE",
                    from: state.previousPackageCode,
                    to: params.targetPackageCode,
                    at: nowIso(),
                  } as PackageEvent,
                ],
              },
            }),
          ]);
        },
        onSuccess: async (value) => {
          await updateDeployment({
            deploymentId: state.deploymentId,
            set: {
              currentStage: "VALIDATE_UPGRADE",
              validatedPackageTransition: value,
            },
            appendToLists: {
              packageEvents: [
                {
                  type: "PACKAGE_STAGE_COMPLETED",
                  stage: "VALIDATE_UPGRADE",
                  from: state.previousPackageCode,
                  to: params.targetPackageCode,
                  at: nowIso(),
                } as PackageEvent,
              ],
            },
          });
        },
        onFailure: async (error) => {
          await Promise.all([
            markJobFailed({
              jobId: state.jobId,
              stage: "VALIDATE_UPGRADE",
              error,
            }),
            updateDeployment({
              deploymentId: state.deploymentId,
              set: {
                status: "FAILED" as DeploymentStatus,
                currentStage: "VALIDATE_UPGRADE",
                lastError: toErrorMessage(error),
                lastErrorDetails: toSerializableError(error),
              },
              appendToLists: {
                packageEvents: [
                  {
                    type: "PACKAGE_UPGRADE_FAILED",
                    from: state.previousPackageCode,
                    to: params.targetPackageCode,
                    addOns: params.addOns,
                    failedStage: "VALIDATE_UPGRADE",
                    stage: "VALIDATE_UPGRADE",
                    at: nowIso(),
                    details: toSerializableError(error),
                  } as PackageEvent,
                ],
              },
            }),
          ]);
        },
      }
    );

    if (!result.ok) {
      return result.failure;
    }
  }

  // 4. GITHUB_SYNC
  {
    const result = await runStage(
      state,
      "GITHUB_SYNC",
      async () => {
        if (!state.deployment) {
          throw new Error("deployment missing before GitHub sync");
        }

        if (!state.deployment.repo) {
          return {
            skipped: true,
            reason: "No repo linked to deployment",
          };
        }

        const dispatchResult = await dispatchDeploymentWorkflow({
          repo: state.deployment.repo,
          bucket: String(state.deployment.bucketName ?? ""),
          distributionId: String(state.deployment.cloudfrontDistributionId ?? ""),
        });

        if (!dispatchResult.success) {
          throw new Error(
            dispatchResult.error ?? "Failed to dispatch deployment workflow"
          );
        }

        return {
          skipped: false,
          repo: state.deployment.repo,
          bucket: state.deployment.bucketName,
          distributionId: state.deployment.cloudfrontDistributionId,
          dispatch: dispatchResult.details,
        };
      },
      {
        onStart: async () => {
          await Promise.all([
            markJobRunning({
              jobId: state.jobId,
              stage: "GITHUB_SYNC",
            }),
            updateDeployment({
              deploymentId: state.deploymentId,
              set: {
                currentStage: "GITHUB_SYNC",
              },
              appendToLists: {
                packageEvents: [
                  {
                    type: "PACKAGE_STAGE_STARTED",
                    stage: "GITHUB_SYNC",
                    from: state.previousPackageCode,
                    to: params.targetPackageCode,
                    at: nowIso(),
                  } as PackageEvent,
                ],
              },
            }),
          ]);
        },
        onSuccess: async (value) => {
          await updateDeployment({
            deploymentId: state.deploymentId,
            set: {
              currentStage: "GITHUB_SYNC",
              githubPackageSync: value,
            },
            appendToLists: {
              packageEvents: [
                {
                  type: "PACKAGE_STAGE_COMPLETED",
                  stage: "GITHUB_SYNC",
                  from: state.previousPackageCode,
                  to: params.targetPackageCode,
                  at: nowIso(),
                } as PackageEvent,
              ],
            },
          });
        },
        onFailure: async (error) => {
          await Promise.all([
            markJobFailed({
              jobId: state.jobId,
              stage: "GITHUB_SYNC",
              error,
            }),
            updateDeployment({
              deploymentId: state.deploymentId,
              set: {
                status: "FAILED" as DeploymentStatus,
                currentStage: "GITHUB_SYNC",
                lastError: toErrorMessage(error),
                lastErrorDetails: toSerializableError(error),
              },
              appendToLists: {
                packageEvents: [
                  {
                    type: "PACKAGE_UPGRADE_FAILED",
                    from: state.previousPackageCode,
                    to: params.targetPackageCode,
                    addOns: params.addOns,
                    failedStage: "GITHUB_SYNC",
                    stage: "GITHUB_SYNC",
                    at: nowIso(),
                    details: toSerializableError(error),
                  } as PackageEvent,
                ],
              },
            }),
          ]);
        },
      }
    );

    if (!result.ok) {
      return result.failure;
    }
  }

  // 5. DYNAMODB
  {
    const result = await runStage(
      state,
      "DYNAMODB",
      async () => {
        if (!state.deployment) {
          throw new Error("deployment missing before persistence");
        }

        if (!state.previousPackageCode) {
          throw new Error("previousPackageCode missing before persistence");
        }

        if (!state.plan) {
          throw new Error("resolved plan missing before persistence");
        }

        await updateDeployment({
          deploymentId: state.deploymentId,
          set: {
            status: "SUCCEEDED" as DeploymentStatus,
            currentStage: "DYNAMODB",
            currentPackageCode: params.targetPackageCode,
            addOns: params.addOns,
            planSnapshot: state.plan,
          },
          appendToLists: {
            packageEvents: [
              {
                type: "PACKAGE_UPGRADE_REQUESTED",
                from: state.previousPackageCode,
                to: params.targetPackageCode,
                addOns: params.addOns,
                stage: "DYNAMODB",
                at: nowIso(),
                details: {
                  plan: state.plan,
                },
              } as PackageEvent,
            ],
          },
          remove: ["pendingPlanSnapshot"],
        });

        return {
          deploymentId: params.deploymentId,
          jobId: state.jobId,
        };
      },
      {
        onStart: async () => {
          await markJobRunning({
            jobId: state.jobId,
            stage: "DYNAMODB",
          });
        },
        onSuccess: async () => {
          await Promise.all([
            markJobSucceeded({
              jobId: state.jobId,
              extra: {
                currentStage: "DYNAMODB",
                payload: {
                  previousPackageCode: state.previousPackageCode,
                  targetPackageCode: params.targetPackageCode,
                  addOns: params.addOns,
                  plan: state.plan,
                },
              },
            }),
            updateDeployment({
              deploymentId: state.deploymentId,
              appendToLists: {
                packageEvents: [
                  {
                    type: "PACKAGE_STAGE_COMPLETED",
                    stage: "DYNAMODB",
                    from: state.previousPackageCode,
                    to: params.targetPackageCode,
                    at: nowIso(),
                  } as PackageEvent,
                ],
              },
            }),
          ]);
        },
        onFailure: async (error) => {
          await Promise.all([
            markJobFailed({
              jobId: state.jobId,
              stage: "DYNAMODB",
              error,
            }),
            updateDeployment({
              deploymentId: state.deploymentId,
              set: {
                status: "FAILED" as DeploymentStatus,
                currentStage: "DYNAMODB",
                lastError: toErrorMessage(error),
                lastErrorDetails: toSerializableError(error),
              },
              appendToLists: {
                packageEvents: [
                  {
                    type: "PACKAGE_UPGRADE_FAILED",
                    from: state.previousPackageCode,
                    to: params.targetPackageCode,
                    addOns: params.addOns,
                    failedStage: "DYNAMODB",
                    stage: "DYNAMODB",
                    at: nowIso(),
                    details: toSerializableError(error),
                  } as PackageEvent,
                ],
              },
            }),
          ]);
        },
      }
    );

    if (!result.ok) {
      return result.failure;
    }
  }

  // 6. SQS
  {
    const result = await runStage(
      state,
      "SQS",
      async () => {
        const messageId = await queueJob({
          jobId: state.jobId,
          deploymentId: params.deploymentId,
          customerId: params.customerId,
          type: "PACKAGE_UPGRADE",
        });

        return {
          queued: true,
          jobId: state.jobId,
          messageId,
        };
      },
      {
        onStart: async () => {
          await markJobRunning({
            jobId: state.jobId,
            stage: "SQS",
          });
        },
        onSuccess: async (value) => {
          await Promise.all([
            updateJob({
              jobId: state.jobId,
              set: {
                currentStage: "SQS",
                queuedMessageId: value.messageId,
              },
            }),
            updateDeployment({
              deploymentId: state.deploymentId,
              set: {
                currentStage: "SQS",
                queuedMessageId: value.messageId,
              },
              appendToLists: {
                packageEvents: [
                  {
                    type: "PACKAGE_STAGE_COMPLETED",
                    stage: "SQS",
                    from: state.previousPackageCode,
                    to: params.targetPackageCode,
                    at: nowIso(),
                    details: value,
                  } as PackageEvent,
                ],
              },
            }),
          ]);
        },
        onFailure: async (error) => {
          await Promise.all([
            markJobFailed({
              jobId: state.jobId,
              stage: "SQS",
              error,
            }),
            updateDeployment({
              deploymentId: state.deploymentId,
              set: {
                status: "FAILED" as DeploymentStatus,
                currentStage: "SQS",
                lastError: toErrorMessage(error),
                lastErrorDetails: toSerializableError(error),
              },
              appendToLists: {
                packageEvents: [
                  {
                    type: "PACKAGE_UPGRADE_FAILED",
                    from: state.previousPackageCode,
                    to: params.targetPackageCode,
                    addOns: params.addOns,
                    failedStage: "SQS",
                    stage: "SQS",
                    at: nowIso(),
                    details: toSerializableError(error),
                  } as PackageEvent,
                ],
              },
            }),
          ]);
        },
      }
    );

    if (!result.ok) {
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
    plan: state.plan!,
    stages: state.stages,
  };
}