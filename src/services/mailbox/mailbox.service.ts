import crypto from 'node:crypto';
import {
  getDeploymentById,
  putDeployment,
  putJob,
  type DeploymentRecord
} from '../aws/dynamodb.service';
import { queueJob } from '../aws/sqs.service';
import { ensureValidDomain } from '../../utils/domain.util';

type MailboxStage =
  | 'DEPLOYMENT_LOOKUP'
  | 'DOMAIN_OWNERSHIP_CHECK'
  | 'MAILBOX_VALIDATE'
  | 'DYNAMODB'
  | 'SQS';

type StageStatus = 'PENDING' | 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED';

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

function createStage(stage: MailboxStage): MailboxStageRecord {
  return {
    stage,
    status: 'IN_PROGRESS',
    startedAt: nowIso()
  };
}

function normalizeLocalPart(input: string): string {
  return input.trim().toLowerCase();
}

function validateMailboxLocalPart(localPart: string): void {
  if (!localPart) {
    throw new Error('mailboxLocalPart is required');
  }

  if (localPart.length < 1 || localPart.length > 64) {
    throw new Error('mailboxLocalPart must be between 1 and 64 characters');
  }

  if (!/^[a-z0-9._-]+$/.test(localPart)) {
    throw new Error(
      'mailboxLocalPart may only contain lowercase letters, numbers, dot, underscore and hyphen'
    );
  }

  if (localPart.startsWith('.') || localPart.endsWith('.')) {
    throw new Error('mailboxLocalPart cannot start or end with a dot');
  }

  if (localPart.includes('..')) {
    throw new Error('mailboxLocalPart cannot contain consecutive dots');
  }
}

function validateQuantity(quantity: number): void {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new Error('quantity must be a positive integer');
  }

  if (quantity > 100) {
    throw new Error('quantity cannot be greater than 100');
  }
}

async function runStage<T>(
  state: RuntimeState,
  stage: MailboxStage,
  executor: () => Promise<T>
): Promise<{ ok: true; value: T } | { ok: false; failure: AddMailboxFailure }> {
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
  failedStage: MailboxStage,
  failure: AddMailboxFailure
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
        mailboxRequests: [
          ...((Array.isArray(state.deployment.mailboxRequests)
            ? state.deployment.mailboxRequests
            : []) as unknown[]),
          {
            type: 'MAILBOX_ADD_FAILED',
            email: state.email,
            domain: state.domain,
            quantity: state.quantity,
            failedStage,
            at: timestamp
          }
        ]
      });
    }
  } catch (error) {
    console.error('[MAILBOX] Failed to persist deployment failure state', {
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
      jobType: 'ADD_MAILBOX',
      status: 'FAILED',
      payload: {
        email: state.email,
        domain: state.domain,
        quantity: state.quantity,
        failedStage
      },
      stages: state.stages,
      lastError: failure.error,
      lastErrorDetails: failure.details,
      createdAt: timestamp,
      updatedAt: timestamp
    });
  } catch (error) {
    console.error('[MAILBOX] Failed to persist job failure state', {
      jobId: state.jobId,
      failedStage,
      error: toErrorMessage(error)
    });
  }
}

export async function addMailboxToDeployment(
  params: AddMailboxParams
): Promise<AddMailboxResult> {
  const normalizedDomain = ensureValidDomain(params.domain);
  const localPart = normalizeLocalPart(params.mailboxLocalPart);
  const quantity = params.quantity ?? 1;
  const email = `${localPart}@${normalizedDomain}`;

  const state: RuntimeState = {
    deploymentId: params.deploymentId,
    jobId: crypto.randomUUID(),
    customerId: params.customerId,
    domain: normalizedDomain,
    mailboxLocalPart: localPart,
    quantity,
    email,
    stages: []
  };

  // 1. DEPLOYMENT_LOOKUP
  {
    const result = await runStage(state, 'DEPLOYMENT_LOOKUP', async () => {
      const deployment = (await getDeploymentById(params.deploymentId)) as DeploymentWithMailboxState | null;

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
        domains: deployment.domains ?? []
      };
    });

    if (!result.ok) {
      await persistFailureState(state, 'DEPLOYMENT_LOOKUP', result.failure);
      return result.failure;
    }
  }

  // 2. DOMAIN_OWNERSHIP_CHECK
  {
    const result = await runStage(state, 'DOMAIN_OWNERSHIP_CHECK', async () => {
      if (!state.deployment) {
        throw new Error('deployment missing before domain ownership check');
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
        belongsToDeployment: true
      };
    });

    if (!result.ok) {
      await persistFailureState(state, 'DOMAIN_OWNERSHIP_CHECK', result.failure);
      return result.failure;
    }
  }

  // 3. MAILBOX_VALIDATE
  {
    const result = await runStage(state, 'MAILBOX_VALIDATE', async () => {
      validateMailboxLocalPart(localPart);
      validateQuantity(quantity);

      state.mailboxRequest = {
        email,
        localPart,
        domain: normalizedDomain,
        quantity
      };

      return state.mailboxRequest;
    });

    if (!result.ok) {
      await persistFailureState(state, 'MAILBOX_VALIDATE', result.failure);
      return result.failure;
    }
  }

  // 4. DYNAMODB
  {
    const result = await runStage(state, 'DYNAMODB', async () => {
      if (!state.deployment) {
        throw new Error('deployment missing before persistence');
      }

      if (!state.mailboxRequest) {
        throw new Error('mailboxRequest missing before persistence');
      }

      const timestamp = nowIso();

      await putDeployment({
        ...state.deployment,
        id: state.deployment.id,
        customerId: state.deployment.customerId,
        status: 'QUEUED',
        currentStage: 'DYNAMODB',
        updatedAt: timestamp,
        mailboxRequests: [
          ...((Array.isArray(state.deployment.mailboxRequests)
            ? state.deployment.mailboxRequests
            : []) as unknown[]),
          {
            type: 'MAILBOX_ADD_REQUESTED',
            email: state.mailboxRequest.email,
            localPart: state.mailboxRequest.localPart,
            domain: state.mailboxRequest.domain,
            quantity: state.mailboxRequest.quantity,
            at: timestamp
          }
        ]
      });

      await putJob({
        id: state.jobId,
        customerId: state.customerId,
        deploymentId: state.deploymentId,
        jobType: 'ADD_MAILBOX',
        status: 'QUEUED',
        payload: state.mailboxRequest,
        stages: state.stages,
        createdAt: timestamp,
        updatedAt: timestamp
      });

      return {
        deploymentId: state.deploymentId,
        jobId: state.jobId,
        email: state.mailboxRequest.email
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
        type: 'ADD_MAILBOX'
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
    email: state.email,
    quantity: state.quantity,
    stages: state.stages
  };
}