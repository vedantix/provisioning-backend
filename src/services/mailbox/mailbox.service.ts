import crypto from "node:crypto";
import {
  getDeploymentById,
  putJob,
  updateDeployment,
  updateJob,
  type DeploymentRecord,
} from "../aws/dynamodb.service";
import { queueJob } from "../aws/sqs.service";
import { ensureValidDomain } from "../../utils/domain.util";

type MailboxStage =
  | "DEPLOYMENT_LOOKUP"
  | "DOMAIN_OWNERSHIP_CHECK"
  | "MAILBOX_VALIDATE"
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

type MailboxStageRecord = {
  stage: MailboxStage;
  status: StageStatus;
  startedAt: string;
  completedAt?: string;
  error?: string;
  details?: unknown;
};

type AddMailboxParams = {
  customerId: string;
  deploymentId: string;
  domain: string;
  mailboxLocalPart: string;
  quantity?: number;
};

type MailboxRequestPayload = {
  email: string;
  localPart: string;
  domain: string;
  quantity: number;
};

type AddMailboxFailure = {
  success: false;
  stage: MailboxStage;
  error: string;
  details?: unknown;
  deploymentId: string;
  jobId: string;
  stages: MailboxStageRecord[];
};

type AddMailboxSuccess = {
  success: true;
  deploymentId: string;
  jobId: string;
  customerId: string;
  email: string;
  quantity: number;
  stages: MailboxStageRecord[];
};

export type AddMailboxResult = AddMailboxSuccess | AddMailboxFailure;

type DeploymentWithMailboxState = DeploymentRecord & {
  mailboxRequests?: unknown[];
};

type RuntimeState = {
  deploymentId: string;
  jobId: string;
  customerId: string;
  domain: string;
  mailboxLocalPart: string;
  quantity: number;
  email: string;
  stages: MailboxStageRecord[];
  deployment?: DeploymentWithMailboxState;
  mailboxRequest?: MailboxRequestPayload;
};

type MailboxEvent = {
  type:
    | "MAILBOX_ADD_STARTED"
    | "MAILBOX_STAGE_STARTED"
    | "MAILBOX_STAGE_COMPLETED"
    | "MAILBOX_ADD_FAILED"
    | "MAILBOX_ADD_REQUESTED";
  stage?: MailboxStage;
  failedStage?: MailboxStage;
  email?: string;
  domain: string;
  quantity?: number;
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

function createStage(stage: MailboxStage): MailboxStageRecord {
  return {
    stage,
    status: "IN_PROGRESS",
    startedAt: nowIso(),
  };
}

function normalizeLocalPart(input: string): string {
  return input.trim().toLowerCase();
}

function validateMailboxLocalPart(localPart: string): void {
  if (!localPart) {
    throw new Error("mailboxLocalPart is required");
  }

  if (localPart.length < 1 || localPart.length > 64) {
    throw new Error("mailboxLocalPart must be between 1 and 64 characters");
  }

  if (!/^[a-z0-9._-]+$/.test(localPart)) {
    throw new Error(
      "mailboxLocalPart may only contain lowercase letters, numbers, dot, underscore and hyphen"
    );
  }

  if (localPart.startsWith(".") || localPart.endsWith(".")) {
    throw new Error("mailboxLocalPart cannot start or end with a dot");
  }

  if (localPart.includes("..")) {
    throw new Error("mailboxLocalPart cannot contain consecutive dots");
  }
}

function validateQuantity(quantity: number): void {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new Error("quantity must be a positive integer");
  }

  if (quantity > 100) {
    throw new Error("quantity cannot be greater than 100");
  }
}

async function appendMailboxEvent(params: {
  deploymentId: string;
  event: MailboxEvent;
}): Promise<void> {
  await updateDeployment({
    deploymentId: params.deploymentId,
    appendToLists: {
      mailboxRequests: [params.event],
    },
  });
}

async function markJobRunning(params: {
  jobId: string;
  stage: MailboxStage;
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
  stage: MailboxStage;
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
  stage: MailboxStage,
  executor: () => Promise<T>,
  hooks?: {
    onStart?: () => Promise<void>;
    onSuccess?: (value: T) => Promise<void>;
    onFailure?: (error: unknown) => Promise<void>;
  }
): Promise<{ ok: true; value: T } | { ok: false; failure: AddMailboxFailure }> {
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

export async function addMailboxToDeployment(
  params: AddMailboxParams
): Promise<AddMailboxResult> {
  const rawDomain = params.domain.trim().toLowerCase();
  ensureValidDomain(rawDomain);

  const normalizedDomain = rawDomain;
  const localPart = normalizeLocalPart(params.mailboxLocalPart);
  const quantity = params.quantity ?? 1;
  const email = `${localPart}@${normalizedDomain}`;
  const startedAt = nowIso();

  const state: RuntimeState = {
    deploymentId: params.deploymentId,
    jobId: `job_${crypto.randomUUID()}`,
    customerId: params.customerId,
    domain: normalizedDomain,
    mailboxLocalPart: localPart,
    quantity,
    email,
    stages: [],
  };

  await putJob({
    id: state.jobId,
    jobId: state.jobId,
    customerId: state.customerId,
    deploymentId: state.deploymentId,
    jobType: "ADD_MAILBOX",
    status: "QUEUED",
    currentStage: "DEPLOYMENT_LOOKUP",
    createdAt: startedAt,
    updatedAt: startedAt,
    payload: {
      email,
      localPart,
      domain: normalizedDomain,
      quantity,
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
      mailboxRequests: [
        {
          type: "MAILBOX_ADD_STARTED",
          stage: "DEPLOYMENT_LOOKUP",
          email,
          domain: normalizedDomain,
          quantity,
          at: startedAt,
        } as MailboxEvent,
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
        )) as DeploymentWithMailboxState | null;

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
          domains: deployment.domains ?? [],
        };
      },
      {
        onStart: async () => {
          await Promise.all([
            markJobRunning({
              jobId: state.jobId,
              stage: "DEPLOYMENT_LOOKUP",
            }),
            appendMailboxEvent({
              deploymentId: state.deploymentId,
              event: {
                type: "MAILBOX_STAGE_STARTED",
                stage: "DEPLOYMENT_LOOKUP",
                email,
                domain: normalizedDomain,
                quantity,
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
              mailboxLookup: value,
            },
            appendToLists: {
              mailboxRequests: [
                {
                  type: "MAILBOX_STAGE_COMPLETED",
                  stage: "DEPLOYMENT_LOOKUP",
                  email,
                  domain: normalizedDomain,
                  quantity,
                  at: nowIso(),
                } as MailboxEvent,
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
                mailboxRequests: [
                  {
                    type: "MAILBOX_ADD_FAILED",
                    stage: "DEPLOYMENT_LOOKUP",
                    failedStage: "DEPLOYMENT_LOOKUP",
                    email,
                    domain: normalizedDomain,
                    quantity,
                    at: nowIso(),
                    details: toSerializableError(error),
                  } as MailboxEvent,
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

  // 2. DOMAIN_OWNERSHIP_CHECK
  {
    const result = await runStage(
      state,
      "DOMAIN_OWNERSHIP_CHECK",
      async () => {
        if (!state.deployment) {
          throw new Error("deployment missing before domain ownership check");
        }

        const domains = Array.isArray(state.deployment.domains)
          ? state.deployment.domains.map((d) => String(d).toLowerCase())
          : [];

        if (!domains.includes(normalizedDomain.toLowerCase())) {
          throw new Error(
            `Domain ${normalizedDomain} is not attached to deployment ${params.deploymentId}`
          );
        }

        return {
          domain: normalizedDomain,
          belongsToDeployment: true,
        };
      },
      {
        onStart: async () => {
          await Promise.all([
            markJobRunning({
              jobId: state.jobId,
              stage: "DOMAIN_OWNERSHIP_CHECK",
            }),
            updateDeployment({
              deploymentId: state.deploymentId,
              set: {
                currentStage: "DOMAIN_OWNERSHIP_CHECK",
              },
              appendToLists: {
                mailboxRequests: [
                  {
                    type: "MAILBOX_STAGE_STARTED",
                    stage: "DOMAIN_OWNERSHIP_CHECK",
                    email,
                    domain: normalizedDomain,
                    quantity,
                    at: nowIso(),
                  } as MailboxEvent,
                ],
              },
            }),
          ]);
        },
        onSuccess: async (value) => {
          await updateDeployment({
            deploymentId: state.deploymentId,
            set: {
              currentStage: "DOMAIN_OWNERSHIP_CHECK",
              mailboxDomainOwnership: value,
            },
            appendToLists: {
              mailboxRequests: [
                {
                  type: "MAILBOX_STAGE_COMPLETED",
                  stage: "DOMAIN_OWNERSHIP_CHECK",
                  email,
                  domain: normalizedDomain,
                  quantity,
                  at: nowIso(),
                } as MailboxEvent,
              ],
            },
          });
        },
        onFailure: async (error) => {
          await Promise.all([
            markJobFailed({
              jobId: state.jobId,
              stage: "DOMAIN_OWNERSHIP_CHECK",
              error,
            }),
            updateDeployment({
              deploymentId: state.deploymentId,
              set: {
                status: "FAILED" as DeploymentStatus,
                currentStage: "DOMAIN_OWNERSHIP_CHECK",
                lastError: toErrorMessage(error),
                lastErrorDetails: toSerializableError(error),
              },
              appendToLists: {
                mailboxRequests: [
                  {
                    type: "MAILBOX_ADD_FAILED",
                    stage: "DOMAIN_OWNERSHIP_CHECK",
                    failedStage: "DOMAIN_OWNERSHIP_CHECK",
                    email,
                    domain: normalizedDomain,
                    quantity,
                    at: nowIso(),
                    details: toSerializableError(error),
                  } as MailboxEvent,
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

  // 3. MAILBOX_VALIDATE
  {
    const result = await runStage(
      state,
      "MAILBOX_VALIDATE",
      async () => {
        validateMailboxLocalPart(localPart);
        validateQuantity(quantity);

        state.mailboxRequest = {
          email,
          localPart,
          domain: normalizedDomain,
          quantity,
        };

        return state.mailboxRequest;
      },
      {
        onStart: async () => {
          await Promise.all([
            markJobRunning({
              jobId: state.jobId,
              stage: "MAILBOX_VALIDATE",
            }),
            updateDeployment({
              deploymentId: state.deploymentId,
              set: {
                currentStage: "MAILBOX_VALIDATE",
              },
              appendToLists: {
                mailboxRequests: [
                  {
                    type: "MAILBOX_STAGE_STARTED",
                    stage: "MAILBOX_VALIDATE",
                    email,
                    domain: normalizedDomain,
                    quantity,
                    at: nowIso(),
                  } as MailboxEvent,
                ],
              },
            }),
          ]);
        },
        onSuccess: async (value) => {
          await updateDeployment({
            deploymentId: state.deploymentId,
            set: {
              currentStage: "MAILBOX_VALIDATE",
              pendingMailboxRequest: value,
            },
            appendToLists: {
              mailboxRequests: [
                {
                  type: "MAILBOX_STAGE_COMPLETED",
                  stage: "MAILBOX_VALIDATE",
                  email,
                  domain: normalizedDomain,
                  quantity,
                  at: nowIso(),
                } as MailboxEvent,
              ],
            },
          });
        },
        onFailure: async (error) => {
          await Promise.all([
            markJobFailed({
              jobId: state.jobId,
              stage: "MAILBOX_VALIDATE",
              error,
            }),
            updateDeployment({
              deploymentId: state.deploymentId,
              set: {
                status: "FAILED" as DeploymentStatus,
                currentStage: "MAILBOX_VALIDATE",
                lastError: toErrorMessage(error),
                lastErrorDetails: toSerializableError(error),
              },
              appendToLists: {
                mailboxRequests: [
                  {
                    type: "MAILBOX_ADD_FAILED",
                    stage: "MAILBOX_VALIDATE",
                    failedStage: "MAILBOX_VALIDATE",
                    email,
                    domain: normalizedDomain,
                    quantity,
                    at: nowIso(),
                    details: toSerializableError(error),
                  } as MailboxEvent,
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

        if (!state.mailboxRequest) {
          throw new Error("mailboxRequest missing before persistence");
        }

        await updateDeployment({
          deploymentId: state.deploymentId,
          set: {
            status: "QUEUED" as DeploymentStatus,
            currentStage: "DYNAMODB",
          },
          appendToLists: {
            mailboxRequests: [
              {
                type: "MAILBOX_ADD_REQUESTED",
                stage: "DYNAMODB",
                email: state.mailboxRequest.email,
                domain: state.mailboxRequest.domain,
                quantity: state.mailboxRequest.quantity,
                at: nowIso(),
                details: {
                  localPart: state.mailboxRequest.localPart,
                },
              } as MailboxEvent,
            ],
          },
          remove: ["pendingMailboxRequest"],
        });

        await updateJob({
          jobId: state.jobId,
          set: {
            currentStage: "DYNAMODB",
            payload: state.mailboxRequest,
          },
        });

        return {
          deploymentId: state.deploymentId,
          jobId: state.jobId,
          email: state.mailboxRequest.email,
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
                  email: value.email,
                  domain: normalizedDomain,
                  quantity,
                },
              },
            }),
            updateDeployment({
              deploymentId: state.deploymentId,
              appendToLists: {
                mailboxRequests: [
                  {
                    type: "MAILBOX_STAGE_COMPLETED",
                    stage: "DYNAMODB",
                    email,
                    domain: normalizedDomain,
                    quantity,
                    at: nowIso(),
                    details: value,
                  } as MailboxEvent,
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
                mailboxRequests: [
                  {
                    type: "MAILBOX_ADD_FAILED",
                    stage: "DYNAMODB",
                    failedStage: "DYNAMODB",
                    email,
                    domain: normalizedDomain,
                    quantity,
                    at: nowIso(),
                    details: toSerializableError(error),
                  } as MailboxEvent,
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
          type: "ADD_MAILBOX",
          payload: state.mailboxRequest,
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
                mailboxRequests: [
                  {
                    type: "MAILBOX_STAGE_COMPLETED",
                    stage: "SQS",
                    email,
                    domain: normalizedDomain,
                    quantity,
                    at: nowIso(),
                    details: value,
                  } as MailboxEvent,
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
                mailboxRequests: [
                  {
                    type: "MAILBOX_ADD_FAILED",
                    stage: "SQS",
                    failedStage: "SQS",
                    email,
                    domain: normalizedDomain,
                    quantity,
                    at: nowIso(),
                    details: toSerializableError(error),
                  } as MailboxEvent,
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
    email: state.email,
    quantity: state.quantity,
    stages: state.stages,
  };
}