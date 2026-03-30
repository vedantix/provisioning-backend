import crypto from "node:crypto";
import { dispatchDeploymentWorkflow } from "../github/github.service";
import {
  getDeploymentById,
  putJob,
  updateDeployment,
  updateJob,
  type DeploymentRecord,
} from "../aws/dynamodb.service";
import { queueJob } from "../aws/sqs.service";

type RedeployStage =
  | "DEPLOYMENT_LOOKUP"
  | "VALIDATE_DEPLOYMENT"
  | "GITHUB_DISPATCH"
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

type DeploymentEvent = {
  type:
    | "REDEPLOY_STARTED"
    | "REDEPLOY_STAGE_STARTED"
    | "REDEPLOY_STAGE_COMPLETED"
    | "REDEPLOY_FAILED"
    | "REDEPLOY_REQUESTED";
  stage?: RedeployStage;
  failedStage?: RedeployStage;
  at: string;
  details?: Record<string, unknown>;
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

function createStage(stage: RedeployStage): RedeployStageRecord {
  return {
    stage,
    status: "IN_PROGRESS",
    startedAt: nowIso(),
  };
}

async function appendDeploymentEvent(params: {
  deploymentId: string;
  event: DeploymentEvent;
}): Promise<void> {
  await updateDeployment({
    deploymentId: params.deploymentId,
    appendToLists: {
      deploymentEvents: [params.event],
    },
  });
}

async function markJobRunning(params: {
  jobId: string;
  stage: RedeployStage;
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
  stage: RedeployStage;
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
  stage: RedeployStage,
  executor: () => Promise<T>,
  hooks?: {
    onStart?: () => Promise<void>;
    onSuccess?: (value: T) => Promise<void>;
    onFailure?: (error: unknown) => Promise<void>;
  }
): Promise<{ ok: true; value: T } | { ok: false; failure: RedeployFailure }> {
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

export async function redeploySite(
  params: RedeployParams
): Promise<RedeployResult> {
  const startedAt = nowIso();

  const state: RuntimeState = {
    deploymentId: params.deploymentId,
    jobId: `job_${crypto.randomUUID()}`,
    customerId: params.customerId,
    stages: [],
  };

  await putJob({
    id: state.jobId,
    jobId: state.jobId,
    customerId: state.customerId,
    deploymentId: state.deploymentId,
    jobType: "REDEPLOY",
    status: "QUEUED",
    currentStage: "DEPLOYMENT_LOOKUP",
    createdAt: startedAt,
    updatedAt: startedAt,
    payload: {},
  });

  await updateDeployment({
    deploymentId: state.deploymentId,
    set: {
      status: "RUNNING" as DeploymentStatus,
      currentStage: "DEPLOYMENT_LOOKUP",
      updatedAt: startedAt,
    },
    appendToLists: {
      deploymentEvents: [
        {
          type: "REDEPLOY_STARTED",
          stage: "DEPLOYMENT_LOOKUP",
          at: startedAt,
        } as DeploymentEvent,
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
        )) as DeploymentWithRepo | null;

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
          cloudfrontDistributionId: deployment.cloudfrontDistributionId ?? null,
        };
      },
      {
        onStart: async () => {
          await Promise.all([
            markJobRunning({
              jobId: state.jobId,
              stage: "DEPLOYMENT_LOOKUP",
            }),
            appendDeploymentEvent({
              deploymentId: state.deploymentId,
              event: {
                type: "REDEPLOY_STAGE_STARTED",
                stage: "DEPLOYMENT_LOOKUP",
                at: nowIso(),
              },
            }),
          ]);
        },
        onSuccess: async (value) => {
          await updateDeployment({
            deploymentId: state.deploymentId,
            set: {
              currentStage: "DEPLOYMENT_LOOKUP",
              redeployLookup: value,
            },
            appendToLists: {
              deploymentEvents: [
                {
                  type: "REDEPLOY_STAGE_COMPLETED",
                  stage: "DEPLOYMENT_LOOKUP",
                  at: nowIso(),
                } as DeploymentEvent,
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
                deploymentEvents: [
                  {
                    type: "REDEPLOY_FAILED",
                    stage: "DEPLOYMENT_LOOKUP",
                    failedStage: "DEPLOYMENT_LOOKUP",
                    at: nowIso(),
                    details: toSerializableError(error),
                  } as DeploymentEvent,
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

  // 2. VALIDATE_DEPLOYMENT
  {
    const result = await runStage(
      state,
      "VALIDATE_DEPLOYMENT",
      async () => {
        if (!state.deployment) {
          throw new Error("deployment missing before validation");
        }

        if (!state.deployment.repo || typeof state.deployment.repo !== "string") {
          throw new Error(`Deployment ${params.deploymentId} has no repo`);
        }

        if (
          !state.deployment.bucketName ||
          typeof state.deployment.bucketName !== "string"
        ) {
          throw new Error(`Deployment ${params.deploymentId} has no bucketName`);
        }

        if (
          !state.deployment.cloudfrontDistributionId ||
          typeof state.deployment.cloudfrontDistributionId !== "string"
        ) {
          throw new Error(
            `Deployment ${params.deploymentId} has no cloudfrontDistributionId`
          );
        }

        return {
          repo: state.deployment.repo,
          bucket: state.deployment.bucketName,
          distributionId: state.deployment.cloudfrontDistributionId,
        };
      },
      {
        onStart: async () => {
          await Promise.all([
            markJobRunning({
              jobId: state.jobId,
              stage: "VALIDATE_DEPLOYMENT",
            }),
            updateDeployment({
              deploymentId: state.deploymentId,
              set: {
                currentStage: "VALIDATE_DEPLOYMENT",
              },
              appendToLists: {
                deploymentEvents: [
                  {
                    type: "REDEPLOY_STAGE_STARTED",
                    stage: "VALIDATE_DEPLOYMENT",
                    at: nowIso(),
                  } as DeploymentEvent,
                ],
              },
            }),
          ]);
        },
        onSuccess: async (value) => {
          await updateDeployment({
            deploymentId: state.deploymentId,
            set: {
              currentStage: "VALIDATE_DEPLOYMENT",
              redeployValidation: value,
            },
            appendToLists: {
              deploymentEvents: [
                {
                  type: "REDEPLOY_STAGE_COMPLETED",
                  stage: "VALIDATE_DEPLOYMENT",
                  at: nowIso(),
                } as DeploymentEvent,
              ],
            },
          });
        },
        onFailure: async (error) => {
          await Promise.all([
            markJobFailed({
              jobId: state.jobId,
              stage: "VALIDATE_DEPLOYMENT",
              error,
            }),
            updateDeployment({
              deploymentId: state.deploymentId,
              set: {
                status: "FAILED" as DeploymentStatus,
                currentStage: "VALIDATE_DEPLOYMENT",
                lastError: toErrorMessage(error),
                lastErrorDetails: toSerializableError(error),
              },
              appendToLists: {
                deploymentEvents: [
                  {
                    type: "REDEPLOY_FAILED",
                    stage: "VALIDATE_DEPLOYMENT",
                    failedStage: "VALIDATE_DEPLOYMENT",
                    at: nowIso(),
                    details: toSerializableError(error),
                  } as DeploymentEvent,
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

  // 3. GITHUB_DISPATCH
  {
    const result = await runStage(
      state,
      "GITHUB_DISPATCH",
      async () => {
        if (
          !state.deployment?.repo ||
          !state.deployment.bucketName ||
          !state.deployment.cloudfrontDistributionId
        ) {
          throw new Error(
            "deployment missing repo/bucket/distribution before dispatch"
          );
        }

        const dispatchResult = await dispatchDeploymentWorkflow({
          repo: state.deployment.repo,
          bucket: String(state.deployment.bucketName),
          distributionId: String(state.deployment.cloudfrontDistributionId),
        });

        if (!dispatchResult.success) {
          throw new Error(
            dispatchResult.error ?? "Failed to dispatch redeploy workflow"
          );
        }

        return {
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
              stage: "GITHUB_DISPATCH",
            }),
            updateDeployment({
              deploymentId: state.deploymentId,
              set: {
                currentStage: "GITHUB_DISPATCH",
              },
              appendToLists: {
                deploymentEvents: [
                  {
                    type: "REDEPLOY_STAGE_STARTED",
                    stage: "GITHUB_DISPATCH",
                    at: nowIso(),
                  } as DeploymentEvent,
                ],
              },
            }),
          ]);
        },
        onSuccess: async (value) => {
          await updateDeployment({
            deploymentId: state.deploymentId,
            set: {
              currentStage: "GITHUB_DISPATCH",
              githubRedeployDispatch: value,
            },
            appendToLists: {
              deploymentEvents: [
                {
                  type: "REDEPLOY_STAGE_COMPLETED",
                  stage: "GITHUB_DISPATCH",
                  at: nowIso(),
                } as DeploymentEvent,
              ],
            },
          });
        },
        onFailure: async (error) => {
          await Promise.all([
            markJobFailed({
              jobId: state.jobId,
              stage: "GITHUB_DISPATCH",
              error,
            }),
            updateDeployment({
              deploymentId: state.deploymentId,
              set: {
                status: "FAILED" as DeploymentStatus,
                currentStage: "GITHUB_DISPATCH",
                lastError: toErrorMessage(error),
                lastErrorDetails: toSerializableError(error),
              },
              appendToLists: {
                deploymentEvents: [
                  {
                    type: "REDEPLOY_FAILED",
                    stage: "GITHUB_DISPATCH",
                    failedStage: "GITHUB_DISPATCH",
                    at: nowIso(),
                    details: toSerializableError(error),
                  } as DeploymentEvent,
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

  // 4. DYNAMODB
  {
    const result = await runStage(
      state,
      "DYNAMODB",
      async () => {
        if (!state.deployment) {
          throw new Error("deployment missing before persistence");
        }

        await updateDeployment({
          deploymentId: state.deploymentId,
          set: {
            status: "QUEUED" as DeploymentStatus,
            currentStage: "DYNAMODB",
          },
          appendToLists: {
            deploymentEvents: [
              {
                type: "REDEPLOY_REQUESTED",
                stage: "DYNAMODB",
                at: nowIso(),
                details: {
                  repo: state.deployment.repo,
                  bucket: state.deployment.bucketName,
                  distributionId: state.deployment.cloudfrontDistributionId,
                },
              } as DeploymentEvent,
            ],
          },
        });

        await updateJob({
          jobId: state.jobId,
          set: {
            currentStage: "DYNAMODB",
            payload: {
              repo: state.deployment.repo,
              bucket: state.deployment.bucketName,
              distributionId: state.deployment.cloudfrontDistributionId,
            },
          },
        });

        return {
          deploymentId: state.deploymentId,
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
                  repo: state.deployment?.repo,
                  bucket: state.deployment?.bucketName,
                  distributionId: state.deployment?.cloudfrontDistributionId,
                },
              },
            }),
            updateDeployment({
              deploymentId: state.deploymentId,
              appendToLists: {
                deploymentEvents: [
                  {
                    type: "REDEPLOY_STAGE_COMPLETED",
                    stage: "DYNAMODB",
                    at: nowIso(),
                  } as DeploymentEvent,
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
                deploymentEvents: [
                  {
                    type: "REDEPLOY_FAILED",
                    stage: "DYNAMODB",
                    failedStage: "DYNAMODB",
                    at: nowIso(),
                    details: toSerializableError(error),
                  } as DeploymentEvent,
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

  // 5. SQS
  {
    const result = await runStage(
      state,
      "SQS",
      async () => {
        const messageId = await queueJob({
          jobId: state.jobId,
          deploymentId: state.deploymentId,
          customerId: state.customerId,
          type: "REDEPLOY",
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
                deploymentEvents: [
                  {
                    type: "REDEPLOY_STAGE_COMPLETED",
                    stage: "SQS",
                    at: nowIso(),
                    details: value,
                  } as DeploymentEvent,
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
                deploymentEvents: [
                  {
                    type: "REDEPLOY_FAILED",
                    stage: "SQS",
                    failedStage: "SQS",
                    at: nowIso(),
                    details: toSerializableError(error),
                  } as DeploymentEvent,
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
    deploymentId: state.deploymentId,
    jobId: state.jobId,
    customerId: state.customerId,
    repo: String(state.deployment!.repo),
    bucket: String(state.deployment!.bucketName),
    distributionId: String(state.deployment!.cloudfrontDistributionId),
    stages: state.stages,
  };
}