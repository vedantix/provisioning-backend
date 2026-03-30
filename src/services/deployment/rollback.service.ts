import crypto from "node:crypto";
import {
  getDeploymentById,
  putJob,
  updateDeployment,
  updateJob,
  type DeploymentRecord,
} from "../aws/dynamodb.service";
import { queueJob } from "../aws/sqs.service";
import { dispatchRollbackWorkflow } from "../github/github.service";

type RollbackStage =
  | "DEPLOYMENT_LOOKUP"
  | "VALIDATE_ROLLBACK"
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

type DeploymentEvent = {
  type:
    | "ROLLBACK_STARTED"
    | "ROLLBACK_STAGE_STARTED"
    | "ROLLBACK_STAGE_COMPLETED"
    | "ROLLBACK_FAILED"
    | "ROLLBACK_REQUESTED";
  stage?: RollbackStage;
  failedStage?: RollbackStage;
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

function createStage(stage: RollbackStage): RollbackStageRecord {
  return {
    stage,
    status: "IN_PROGRESS",
    startedAt: nowIso(),
  };
}

function validateTargetRef(targetRef: string): void {
  const normalized = targetRef.trim();

  if (!normalized) {
    throw new Error("targetRef is required");
  }

  if (normalized.length < 3 || normalized.length > 200) {
    throw new Error("targetRef length is invalid");
  }

  if (!/^[a-zA-Z0-9._/\-]+$/.test(normalized)) {
    throw new Error("targetRef contains unsupported characters");
  }
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
  stage: RollbackStage;
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
  stage: RollbackStage;
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
  stage: RollbackStage,
  executor: () => Promise<T>,
  hooks?: {
    onStart?: () => Promise<void>;
    onSuccess?: (value: T) => Promise<void>;
    onFailure?: (error: unknown) => Promise<void>;
  }
): Promise<{ ok: true; value: T } | { ok: false; failure: RollbackFailure }> {
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

export async function rollbackSite(
  params: RollbackParams
): Promise<RollbackResult> {
  const startedAt = nowIso();

  const state: RuntimeState = {
    deploymentId: params.deploymentId,
    jobId: `job_${crypto.randomUUID()}`,
    customerId: params.customerId,
    targetRef: params.targetRef.trim(),
    stages: [],
  };

  await putJob({
    id: state.jobId,
    jobId: state.jobId,
    customerId: state.customerId,
    deploymentId: state.deploymentId,
    jobType: "ROLLBACK",
    status: "QUEUED",
    currentStage: "DEPLOYMENT_LOOKUP",
    createdAt: startedAt,
    updatedAt: startedAt,
    payload: {
      targetRef: state.targetRef,
    },
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
          type: "ROLLBACK_STARTED",
          stage: "DEPLOYMENT_LOOKUP",
          at: startedAt,
          details: {
            targetRef: state.targetRef,
          },
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
                type: "ROLLBACK_STAGE_STARTED",
                stage: "DEPLOYMENT_LOOKUP",
                at: nowIso(),
                details: {
                  targetRef: state.targetRef,
                },
              },
            }),
          ]);
        },
        onSuccess: async (value) => {
          await updateDeployment({
            deploymentId: state.deploymentId,
            set: {
              currentStage: "DEPLOYMENT_LOOKUP",
              rollbackLookup: value,
            },
            appendToLists: {
              deploymentEvents: [
                {
                  type: "ROLLBACK_STAGE_COMPLETED",
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
                    type: "ROLLBACK_FAILED",
                    stage: "DEPLOYMENT_LOOKUP",
                    failedStage: "DEPLOYMENT_LOOKUP",
                    at: nowIso(),
                    details: {
                      targetRef: state.targetRef,
                      error: toSerializableError(error),
                    },
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

  // 2. VALIDATE_ROLLBACK
  {
    const result = await runStage(
      state,
      "VALIDATE_ROLLBACK",
      async () => {
        if (!state.deployment) {
          throw new Error("deployment missing before rollback validation");
        }

        validateTargetRef(state.targetRef);

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
          targetRef: state.targetRef,
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
              stage: "VALIDATE_ROLLBACK",
            }),
            updateDeployment({
              deploymentId: state.deploymentId,
              set: {
                currentStage: "VALIDATE_ROLLBACK",
              },
              appendToLists: {
                deploymentEvents: [
                  {
                    type: "ROLLBACK_STAGE_STARTED",
                    stage: "VALIDATE_ROLLBACK",
                    at: nowIso(),
                    details: {
                      targetRef: state.targetRef,
                    },
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
              currentStage: "VALIDATE_ROLLBACK",
              rollbackValidation: value,
            },
            appendToLists: {
              deploymentEvents: [
                {
                  type: "ROLLBACK_STAGE_COMPLETED",
                  stage: "VALIDATE_ROLLBACK",
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
              stage: "VALIDATE_ROLLBACK",
              error,
            }),
            updateDeployment({
              deploymentId: state.deploymentId,
              set: {
                status: "FAILED" as DeploymentStatus,
                currentStage: "VALIDATE_ROLLBACK",
                lastError: toErrorMessage(error),
                lastErrorDetails: toSerializableError(error),
              },
              appendToLists: {
                deploymentEvents: [
                  {
                    type: "ROLLBACK_FAILED",
                    stage: "VALIDATE_ROLLBACK",
                    failedStage: "VALIDATE_ROLLBACK",
                    at: nowIso(),
                    details: {
                      targetRef: state.targetRef,
                      error: toSerializableError(error),
                    },
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
            "deployment missing repo/bucket/distribution before rollback dispatch"
          );
        }

        const dispatchResult = await dispatchRollbackWorkflow({
          repo: state.deployment.repo,
          bucket: String(state.deployment.bucketName),
          distributionId: String(state.deployment.cloudfrontDistributionId),
          targetRef: state.targetRef,
        });

        if (!dispatchResult.success) {
          throw new Error(
            dispatchResult.error ?? "Failed to dispatch rollback workflow"
          );
        }

        return {
          repo: state.deployment.repo,
          bucket: state.deployment.bucketName,
          distributionId: state.deployment.cloudfrontDistributionId,
          targetRef: state.targetRef,
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
                    type: "ROLLBACK_STAGE_STARTED",
                    stage: "GITHUB_DISPATCH",
                    at: nowIso(),
                    details: {
                      targetRef: state.targetRef,
                    },
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
              githubRollbackDispatch: value,
            },
            appendToLists: {
              deploymentEvents: [
                {
                  type: "ROLLBACK_STAGE_COMPLETED",
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
                    type: "ROLLBACK_FAILED",
                    stage: "GITHUB_DISPATCH",
                    failedStage: "GITHUB_DISPATCH",
                    at: nowIso(),
                    details: {
                      targetRef: state.targetRef,
                      error: toSerializableError(error),
                    },
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
            rollbackTargetRef: state.targetRef,
          },
          appendToLists: {
            deploymentEvents: [
              {
                type: "ROLLBACK_REQUESTED",
                stage: "DYNAMODB",
                at: nowIso(),
                details: {
                  repo: state.deployment.repo,
                  bucket: state.deployment.bucketName,
                  distributionId: state.deployment.cloudfrontDistributionId,
                  targetRef: state.targetRef,
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
              targetRef: state.targetRef,
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
                  targetRef: state.targetRef,
                },
              },
            }),
            updateDeployment({
              deploymentId: state.deploymentId,
              appendToLists: {
                deploymentEvents: [
                  {
                    type: "ROLLBACK_STAGE_COMPLETED",
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
                    type: "ROLLBACK_FAILED",
                    stage: "DYNAMODB",
                    failedStage: "DYNAMODB",
                    at: nowIso(),
                    details: {
                      targetRef: state.targetRef,
                      error: toSerializableError(error),
                    },
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
          type: "ROLLBACK",
          targetRef: state.targetRef,
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
                    type: "ROLLBACK_STAGE_COMPLETED",
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
                    type: "ROLLBACK_FAILED",
                    stage: "SQS",
                    failedStage: "SQS",
                    at: nowIso(),
                    details: {
                      targetRef: state.targetRef,
                      error: toSerializableError(error),
                    },
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
    targetRef: state.targetRef,
    repo: String(state.deployment!.repo),
    bucket: String(state.deployment!.bucketName),
    distributionId: String(state.deployment!.cloudfrontDistributionId),
    stages: state.stages,
  };
}