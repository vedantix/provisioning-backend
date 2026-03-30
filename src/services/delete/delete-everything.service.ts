import crypto from "node:crypto";
import {
  getDeploymentById,
  putJob,
  updateDeployment,
  updateJob,
  type DeploymentRecord,
} from "../aws/dynamodb.service";
import { queueJob } from "../aws/sqs.service";
import { removeCloudFrontAliasRecords } from "../aws/route53.service";
import { disableAndDeleteDistribution } from "../aws/cloudfront.service";
import {
  removeCloudFrontReadAccess,
  emptyAndDeleteBucket,
} from "../aws/s3.service";
import { deleteCertificateIfExists } from "../aws/acm.service";

type DeleteEverythingStage =
  | "DEPLOYMENT_LOOKUP"
  | "CONFIRM_CHECK"
  | "ROUTE53_DELETE"
  | "CLOUDFRONT_DELETE"
  | "S3_POLICY_DELETE"
  | "S3_BUCKET_DELETE"
  | "ACM_DELETE"
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

type DeleteEverythingStageRecord = {
  stage: DeleteEverythingStage;
  status: StageStatus;
  startedAt: string;
  completedAt?: string;
  error?: string;
  details?: unknown;
};

type DeleteEverythingParams = {
  customerId: string;
  deploymentId: string;
  confirm: boolean;
};

type DeleteEverythingFailure = {
  success: false;
  stage: DeleteEverythingStage;
  error: string;
  details?: unknown;
  deploymentId: string;
  jobId: string;
  stages: DeleteEverythingStageRecord[];
};

type DeleteEverythingSuccess = {
  success: true;
  deploymentId: string;
  jobId: string;
  customerId: string;
  deleted: {
    route53: boolean;
    cloudfront: boolean;
    s3Policy: boolean;
    s3Bucket: boolean;
    acm: boolean;
  };
  stages: DeleteEverythingStageRecord[];
};

export type DeleteEverythingResult =
  | DeleteEverythingFailure
  | DeleteEverythingSuccess;

type RuntimeState = {
  deploymentId: string;
  jobId: string;
  customerId: string;
  confirm: boolean;
  stages: DeleteEverythingStageRecord[];
  deployment?: DeploymentRecord;
  deleted: {
    route53: boolean;
    cloudfront: boolean;
    s3Policy: boolean;
    s3Bucket: boolean;
    acm: boolean;
  };
};

type DeletionEvent = {
  type:
    | "DELETE_EVERYTHING_STARTED"
    | "DELETE_STAGE_STARTED"
    | "DELETE_STAGE_COMPLETED"
    | "DELETE_EVERYTHING_FAILED"
    | "DELETE_EVERYTHING_COMPLETED";
  stage?: DeleteEverythingStage;
  failedStage?: DeleteEverythingStage;
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

function createStage(stage: DeleteEverythingStage): DeleteEverythingStageRecord {
  return {
    stage,
    status: "IN_PROGRESS",
    startedAt: nowIso(),
  };
}

async function appendDeletionEvent(params: {
  deploymentId: string;
  event: DeletionEvent;
}): Promise<void> {
  await updateDeployment({
    deploymentId: params.deploymentId,
    appendToLists: {
      deletionEvents: [params.event],
    },
  });
}

async function markJobRunning(params: {
  jobId: string;
  stage: DeleteEverythingStage;
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
  stage: DeleteEverythingStage;
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
  stage: DeleteEverythingStage,
  executor: () => Promise<T>,
  hooks?: {
    onStart?: () => Promise<void>;
    onSuccess?: (value: T) => Promise<void>;
    onFailure?: (error: unknown) => Promise<void>;
  }
): Promise<
  { ok: true; value: T } | { ok: false; failure: DeleteEverythingFailure }
> {
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

export async function deleteEverything(
  params: DeleteEverythingParams
): Promise<DeleteEverythingResult> {
  const startedAt = nowIso();

  const state: RuntimeState = {
    deploymentId: params.deploymentId,
    jobId: `job_${crypto.randomUUID()}`,
    customerId: params.customerId,
    confirm: params.confirm,
    stages: [],
    deleted: {
      route53: false,
      cloudfront: false,
      s3Policy: false,
      s3Bucket: false,
      acm: false,
    },
  };

  await putJob({
    id: state.jobId,
    jobId: state.jobId,
    customerId: state.customerId,
    deploymentId: state.deploymentId,
    jobType: "DELETE_EVERYTHING",
    status: "QUEUED",
    currentStage: "DEPLOYMENT_LOOKUP",
    createdAt: startedAt,
    updatedAt: startedAt,
    payload: {
      confirm: params.confirm,
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
      deletionEvents: [
        {
          type: "DELETE_EVERYTHING_STARTED",
          stage: "DEPLOYMENT_LOOKUP",
          at: startedAt,
          details: {
            confirm: params.confirm,
          },
        } as DeletionEvent,
      ],
    },
  });

  // 1. DEPLOYMENT_LOOKUP
  {
    const result = await runStage(
      state,
      "DEPLOYMENT_LOOKUP",
      async () => {
        const deployment = await getDeploymentById(params.deploymentId);

        if (!deployment) {
          throw new Error(`Deployment ${params.deploymentId} not found`);
        }

        if (deployment.customerId !== params.customerId) {
          throw new Error(
            `Deployment ${params.deploymentId} does not belong to customer ${params.customerId}`
          );
        }

        if (!deployment.bucketName) {
          throw new Error(`Deployment ${params.deploymentId} has no bucketName`);
        }

        state.deployment = deployment;

        return {
          deploymentId: deployment.id,
          customerId: deployment.customerId,
          bucketName: deployment.bucketName,
          cloudfrontDistributionId: deployment.cloudfrontDistributionId ?? null,
          certificateArn: deployment.certificateArn ?? null,
          domains: Array.isArray(deployment.domains) ? deployment.domains : [],
        };
      },
      {
        onStart: async () => {
          await Promise.all([
            markJobRunning({
              jobId: state.jobId,
              stage: "DEPLOYMENT_LOOKUP",
            }),
            appendDeletionEvent({
              deploymentId: state.deploymentId,
              event: {
                type: "DELETE_STAGE_STARTED",
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
              deletionLookup: value,
            },
            appendToLists: {
              deletionEvents: [
                {
                  type: "DELETE_STAGE_COMPLETED",
                  stage: "DEPLOYMENT_LOOKUP",
                  at: nowIso(),
                } as DeletionEvent,
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
                deletionEvents: [
                  {
                    type: "DELETE_EVERYTHING_FAILED",
                    stage: "DEPLOYMENT_LOOKUP",
                    failedStage: "DEPLOYMENT_LOOKUP",
                    at: nowIso(),
                    details: {
                      deleted: state.deleted,
                      error: toSerializableError(error),
                    },
                  } as DeletionEvent,
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

  // 2. CONFIRM_CHECK
  {
    const result = await runStage(
      state,
      "CONFIRM_CHECK",
      async () => {
        if (!params.confirm) {
          throw new Error("Explicit confirm=true is required for delete-everything");
        }

        return {
          confirm: true,
        };
      },
      {
        onStart: async () => {
          await Promise.all([
            markJobRunning({
              jobId: state.jobId,
              stage: "CONFIRM_CHECK",
            }),
            updateDeployment({
              deploymentId: state.deploymentId,
              set: {
                currentStage: "CONFIRM_CHECK",
              },
              appendToLists: {
                deletionEvents: [
                  {
                    type: "DELETE_STAGE_STARTED",
                    stage: "CONFIRM_CHECK",
                    at: nowIso(),
                  } as DeletionEvent,
                ],
              },
            }),
          ]);
        },
        onSuccess: async (value) => {
          await updateDeployment({
            deploymentId: state.deploymentId,
            set: {
              currentStage: "CONFIRM_CHECK",
              deleteConfirmation: value,
            },
            appendToLists: {
              deletionEvents: [
                {
                  type: "DELETE_STAGE_COMPLETED",
                  stage: "CONFIRM_CHECK",
                  at: nowIso(),
                } as DeletionEvent,
              ],
            },
          });
        },
        onFailure: async (error) => {
          await Promise.all([
            markJobFailed({
              jobId: state.jobId,
              stage: "CONFIRM_CHECK",
              error,
            }),
            updateDeployment({
              deploymentId: state.deploymentId,
              set: {
                status: "FAILED" as DeploymentStatus,
                currentStage: "CONFIRM_CHECK",
                lastError: toErrorMessage(error),
                lastErrorDetails: toSerializableError(error),
              },
              appendToLists: {
                deletionEvents: [
                  {
                    type: "DELETE_EVERYTHING_FAILED",
                    stage: "CONFIRM_CHECK",
                    failedStage: "CONFIRM_CHECK",
                    at: nowIso(),
                    details: {
                      deleted: state.deleted,
                      error: toSerializableError(error),
                    },
                  } as DeletionEvent,
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

  // 3. ROUTE53_DELETE
  {
    const result = await runStage(
      state,
      "ROUTE53_DELETE",
      async () => {
        if (!state.deployment) {
          throw new Error("deployment missing before Route53 delete");
        }

        const domains = Array.isArray(state.deployment.domains)
          ? state.deployment.domains.map((d) => String(d))
          : [];

        if (!domains.length) {
          return {
            skipped: true,
            reason: "No domains on deployment",
          };
        }

        await removeCloudFrontAliasRecords(domains);
        state.deleted.route53 = true;

        return {
          domainsRemoved: domains,
        };
      },
      {
        onStart: async () => {
          await Promise.all([
            markJobRunning({
              jobId: state.jobId,
              stage: "ROUTE53_DELETE",
            }),
            updateDeployment({
              deploymentId: state.deploymentId,
              set: {
                currentStage: "ROUTE53_DELETE",
              },
              appendToLists: {
                deletionEvents: [
                  {
                    type: "DELETE_STAGE_STARTED",
                    stage: "ROUTE53_DELETE",
                    at: nowIso(),
                  } as DeletionEvent,
                ],
              },
            }),
          ]);
        },
        onSuccess: async (value) => {
          await updateDeployment({
            deploymentId: state.deploymentId,
            set: {
              currentStage: "ROUTE53_DELETE",
            },
            appendToLists: {
              deletionEvents: [
                {
                  type: "DELETE_STAGE_COMPLETED",
                  stage: "ROUTE53_DELETE",
                  at: nowIso(),
                  details: value,
                } as DeletionEvent,
              ],
            },
          });
        },
        onFailure: async (error) => {
          await Promise.all([
            markJobFailed({
              jobId: state.jobId,
              stage: "ROUTE53_DELETE",
              error,
            }),
            updateDeployment({
              deploymentId: state.deploymentId,
              set: {
                status: "FAILED" as DeploymentStatus,
                currentStage: "ROUTE53_DELETE",
                lastError: toErrorMessage(error),
                lastErrorDetails: toSerializableError(error),
              },
              appendToLists: {
                deletionEvents: [
                  {
                    type: "DELETE_EVERYTHING_FAILED",
                    stage: "ROUTE53_DELETE",
                    failedStage: "ROUTE53_DELETE",
                    at: nowIso(),
                    details: {
                      deleted: state.deleted,
                      error: toSerializableError(error),
                    },
                  } as DeletionEvent,
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

  // 4. CLOUDFRONT_DELETE
  {
    const result = await runStage(
      state,
      "CLOUDFRONT_DELETE",
      async () => {
        if (!state.deployment) {
          throw new Error("deployment missing before CloudFront delete");
        }

        if (!state.deployment.cloudfrontDistributionId) {
          return {
            skipped: true,
            reason: "No cloudfrontDistributionId on deployment",
          };
        }

        const deleteResult = await disableAndDeleteDistribution(
          state.deployment.cloudfrontDistributionId
        );

        state.deleted.cloudfront = true;

        return deleteResult;
      },
      {
        onStart: async () => {
          await Promise.all([
            markJobRunning({
              jobId: state.jobId,
              stage: "CLOUDFRONT_DELETE",
            }),
            updateDeployment({
              deploymentId: state.deploymentId,
              set: {
                currentStage: "CLOUDFRONT_DELETE",
              },
              appendToLists: {
                deletionEvents: [
                  {
                    type: "DELETE_STAGE_STARTED",
                    stage: "CLOUDFRONT_DELETE",
                    at: nowIso(),
                  } as DeletionEvent,
                ],
              },
            }),
          ]);
        },
        onSuccess: async (value) => {
          await updateDeployment({
            deploymentId: state.deploymentId,
            set: {
              currentStage: "CLOUDFRONT_DELETE",
            },
            appendToLists: {
              deletionEvents: [
                {
                  type: "DELETE_STAGE_COMPLETED",
                  stage: "CLOUDFRONT_DELETE",
                  at: nowIso(),
                  details: value,
                } as DeletionEvent,
              ],
            },
          });
        },
        onFailure: async (error) => {
          await Promise.all([
            markJobFailed({
              jobId: state.jobId,
              stage: "CLOUDFRONT_DELETE",
              error,
            }),
            updateDeployment({
              deploymentId: state.deploymentId,
              set: {
                status: "FAILED" as DeploymentStatus,
                currentStage: "CLOUDFRONT_DELETE",
                lastError: toErrorMessage(error),
                lastErrorDetails: toSerializableError(error),
              },
              appendToLists: {
                deletionEvents: [
                  {
                    type: "DELETE_EVERYTHING_FAILED",
                    stage: "CLOUDFRONT_DELETE",
                    failedStage: "CLOUDFRONT_DELETE",
                    at: nowIso(),
                    details: {
                      deleted: state.deleted,
                      error: toSerializableError(error),
                    },
                  } as DeletionEvent,
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

  // 5. S3_POLICY_DELETE
  {
    const result = await runStage(
      state,
      "S3_POLICY_DELETE",
      async () => {
        if (!state.deployment?.bucketName) {
          throw new Error("bucketName missing before S3 policy delete");
        }

        const removeResult = await removeCloudFrontReadAccess({
          bucketName: state.deployment.bucketName,
        });

        state.deleted.s3Policy = true;

        return removeResult;
      },
      {
        onStart: async () => {
          await Promise.all([
            markJobRunning({
              jobId: state.jobId,
              stage: "S3_POLICY_DELETE",
            }),
            updateDeployment({
              deploymentId: state.deploymentId,
              set: {
                currentStage: "S3_POLICY_DELETE",
              },
              appendToLists: {
                deletionEvents: [
                  {
                    type: "DELETE_STAGE_STARTED",
                    stage: "S3_POLICY_DELETE",
                    at: nowIso(),
                  } as DeletionEvent,
                ],
              },
            }),
          ]);
        },
        onSuccess: async (value) => {
          await updateDeployment({
            deploymentId: state.deploymentId,
            set: {
              currentStage: "S3_POLICY_DELETE",
            },
            appendToLists: {
              deletionEvents: [
                {
                  type: "DELETE_STAGE_COMPLETED",
                  stage: "S3_POLICY_DELETE",
                  at: nowIso(),
                  details: value,
                } as DeletionEvent,
              ],
            },
          });
        },
        onFailure: async (error) => {
          await Promise.all([
            markJobFailed({
              jobId: state.jobId,
              stage: "S3_POLICY_DELETE",
              error,
            }),
            updateDeployment({
              deploymentId: state.deploymentId,
              set: {
                status: "FAILED" as DeploymentStatus,
                currentStage: "S3_POLICY_DELETE",
                lastError: toErrorMessage(error),
                lastErrorDetails: toSerializableError(error),
              },
              appendToLists: {
                deletionEvents: [
                  {
                    type: "DELETE_EVERYTHING_FAILED",
                    stage: "S3_POLICY_DELETE",
                    failedStage: "S3_POLICY_DELETE",
                    at: nowIso(),
                    details: {
                      deleted: state.deleted,
                      error: toSerializableError(error),
                    },
                  } as DeletionEvent,
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

  // 6. S3_BUCKET_DELETE
  {
    const result = await runStage(
      state,
      "S3_BUCKET_DELETE",
      async () => {
        if (!state.deployment?.bucketName) {
          throw new Error("bucketName missing before S3 bucket delete");
        }

        const deleteResult = await emptyAndDeleteBucket({
          bucketName: state.deployment.bucketName,
        });

        state.deleted.s3Bucket = true;

        return deleteResult;
      },
      {
        onStart: async () => {
          await Promise.all([
            markJobRunning({
              jobId: state.jobId,
              stage: "S3_BUCKET_DELETE",
            }),
            updateDeployment({
              deploymentId: state.deploymentId,
              set: {
                currentStage: "S3_BUCKET_DELETE",
              },
              appendToLists: {
                deletionEvents: [
                  {
                    type: "DELETE_STAGE_STARTED",
                    stage: "S3_BUCKET_DELETE",
                    at: nowIso(),
                  } as DeletionEvent,
                ],
              },
            }),
          ]);
        },
        onSuccess: async (value) => {
          await updateDeployment({
            deploymentId: state.deploymentId,
            set: {
              currentStage: "S3_BUCKET_DELETE",
            },
            appendToLists: {
              deletionEvents: [
                {
                  type: "DELETE_STAGE_COMPLETED",
                  stage: "S3_BUCKET_DELETE",
                  at: nowIso(),
                  details: value,
                } as DeletionEvent,
              ],
            },
          });
        },
        onFailure: async (error) => {
          await Promise.all([
            markJobFailed({
              jobId: state.jobId,
              stage: "S3_BUCKET_DELETE",
              error,
            }),
            updateDeployment({
              deploymentId: state.deploymentId,
              set: {
                status: "FAILED" as DeploymentStatus,
                currentStage: "S3_BUCKET_DELETE",
                lastError: toErrorMessage(error),
                lastErrorDetails: toSerializableError(error),
              },
              appendToLists: {
                deletionEvents: [
                  {
                    type: "DELETE_EVERYTHING_FAILED",
                    stage: "S3_BUCKET_DELETE",
                    failedStage: "S3_BUCKET_DELETE",
                    at: nowIso(),
                    details: {
                      deleted: state.deleted,
                      error: toSerializableError(error),
                    },
                  } as DeletionEvent,
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

  // 7. ACM_DELETE
  {
    const result = await runStage(
      state,
      "ACM_DELETE",
      async () => {
        if (!state.deployment?.certificateArn) {
          return {
            skipped: true,
            reason: "No certificateArn on deployment",
          };
        }

        const deleteResult = await deleteCertificateIfExists({
          certificateArn: state.deployment.certificateArn,
        });

        state.deleted.acm = true;

        return deleteResult;
      },
      {
        onStart: async () => {
          await Promise.all([
            markJobRunning({
              jobId: state.jobId,
              stage: "ACM_DELETE",
            }),
            updateDeployment({
              deploymentId: state.deploymentId,
              set: {
                currentStage: "ACM_DELETE",
              },
              appendToLists: {
                deletionEvents: [
                  {
                    type: "DELETE_STAGE_STARTED",
                    stage: "ACM_DELETE",
                    at: nowIso(),
                  } as DeletionEvent,
                ],
              },
            }),
          ]);
        },
        onSuccess: async (value) => {
          await updateDeployment({
            deploymentId: state.deploymentId,
            set: {
              currentStage: "ACM_DELETE",
            },
            appendToLists: {
              deletionEvents: [
                {
                  type: "DELETE_STAGE_COMPLETED",
                  stage: "ACM_DELETE",
                  at: nowIso(),
                  details: value,
                } as DeletionEvent,
              ],
            },
          });
        },
        onFailure: async (error) => {
          await Promise.all([
            markJobFailed({
              jobId: state.jobId,
              stage: "ACM_DELETE",
              error,
            }),
            updateDeployment({
              deploymentId: state.deploymentId,
              set: {
                status: "FAILED" as DeploymentStatus,
                currentStage: "ACM_DELETE",
                lastError: toErrorMessage(error),
                lastErrorDetails: toSerializableError(error),
              },
              appendToLists: {
                deletionEvents: [
                  {
                    type: "DELETE_EVERYTHING_FAILED",
                    stage: "ACM_DELETE",
                    failedStage: "ACM_DELETE",
                    at: nowIso(),
                    details: {
                      deleted: state.deleted,
                      error: toSerializableError(error),
                    },
                  } as DeletionEvent,
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

  // 8. DYNAMODB
  {
    const result = await runStage(
      state,
      "DYNAMODB",
      async () => {
        if (!state.deployment) {
          throw new Error("deployment missing before persistence");
        }

        const deletedAt = nowIso();

        await updateDeployment({
          deploymentId: state.deploymentId,
          set: {
            status: "DELETED" as DeploymentStatus,
            currentStage: "DYNAMODB",
            deletedAt,
          },
          remove: [
            "bucketName",
            "cloudfrontDistributionId",
            "cloudfrontDomainName",
            "certificateArn",
            "domains",
            "queuedMessageId",
            "rollbackTargetRef",
            "pendingCertificateArn",
            "pendingPlanSnapshot",
          ],
          appendToLists: {
            deletionEvents: [
              {
                type: "DELETE_EVERYTHING_COMPLETED",
                stage: "DYNAMODB",
                at: deletedAt,
                details: {
                  deleted: state.deleted,
                },
              } as DeletionEvent,
            ],
          },
        });

        await updateJob({
          jobId: state.jobId,
          set: {
            currentStage: "DYNAMODB",
            payload: {
              deleted: state.deleted,
            },
          },
        });

        return {
          deploymentId: state.deploymentId,
          jobId: state.jobId,
          deleted: state.deleted,
        };
      },
      {
        onStart: async () => {
          await markJobRunning({
            jobId: state.jobId,
            stage: "DYNAMODB",
          });
        },
        onSuccess: async (value) => {
          await Promise.all([
            markJobSucceeded({
              jobId: state.jobId,
              extra: {
                currentStage: "DYNAMODB",
                payload: {
                  deleted: value.deleted,
                },
              },
            }),
            updateDeployment({
              deploymentId: state.deploymentId,
              appendToLists: {
                deletionEvents: [
                  {
                    type: "DELETE_STAGE_COMPLETED",
                    stage: "DYNAMODB",
                    at: nowIso(),
                    details: value,
                  } as DeletionEvent,
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
                deletionEvents: [
                  {
                    type: "DELETE_EVERYTHING_FAILED",
                    stage: "DYNAMODB",
                    failedStage: "DYNAMODB",
                    at: nowIso(),
                    details: {
                      deleted: state.deleted,
                      error: toSerializableError(error),
                    },
                  } as DeletionEvent,
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

  // 9. SQS
  {
    const result = await runStage(
      state,
      "SQS",
      async () => {
        const messageId = await queueJob({
          jobId: state.jobId,
          deploymentId: state.deploymentId,
          customerId: state.customerId,
          type: "DELETE_EVERYTHING",
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
                deletionEvents: [
                  {
                    type: "DELETE_STAGE_COMPLETED",
                    stage: "SQS",
                    at: nowIso(),
                    details: value,
                  } as DeletionEvent,
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
                deletionEvents: [
                  {
                    type: "DELETE_EVERYTHING_FAILED",
                    stage: "SQS",
                    failedStage: "SQS",
                    at: nowIso(),
                    details: {
                      deleted: state.deleted,
                      error: toSerializableError(error),
                    },
                  } as DeletionEvent,
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
    deleted: state.deleted,
    stages: state.stages,
  };
}