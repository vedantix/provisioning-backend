import crypto from 'node:crypto';
import type { Request } from 'express';
import type {
  AnyStage,
  DeploymentActionType,
  OperationRecord,
} from '../deployments/types';
import { OperationsRepository } from '../../repositories/operations.repository';

export type IdempotencyLookupInput = {
  idempotencyKey?: string;
  deploymentId?: string;
  type: DeploymentActionType;
  requestHash: string;
  requestedStage?: AnyStage;
};

export type IdempotencyResolution =
  | {
      reused: false;
    }
  | {
      reused: true;
      operation: OperationRecord;
    };

function normalizePayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizePayload);
  }

  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = normalizePayload((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }

  return value;
}

export class IdempotencyService {
  constructor(
    private readonly operationsRepository = new OperationsRepository(),
  ) {}

  createRequestHash(input: {
    type: DeploymentActionType;
    tenantId: string;
    customerId?: string;
    deploymentId?: string;
    requestedStage?: AnyStage;
    body?: unknown;
    path?: string;
    method?: string;
  }): string {
    const normalized = normalizePayload({
      type: input.type,
      tenantId: input.tenantId,
      customerId: input.customerId,
      deploymentId: input.deploymentId,
      requestedStage: input.requestedStage,
      body: input.body ?? null,
      path: input.path ?? null,
      method: input.method ?? null,
    });

    return crypto
      .createHash('sha256')
      .update(JSON.stringify(normalized))
      .digest('hex');
  }

  async resolveExistingOperation(
    input: IdempotencyLookupInput,
  ): Promise<IdempotencyResolution> {
    if (!input.idempotencyKey) {
      return { reused: false };
    }

    const existing = await this.operationsRepository.findByIdempotencyKey(
      input.idempotencyKey,
    );

    if (!existing) {
      return { reused: false };
    }

    if (existing.type !== input.type) {
      return { reused: false };
    }

    if (existing.requestHash !== input.requestHash) {
      return { reused: false };
    }

    if (input.deploymentId && existing.deploymentId !== input.deploymentId) {
      return { reused: false };
    }

    if (
      input.requestedStage &&
      existing.requestedStage !== input.requestedStage
    ) {
      return { reused: false };
    }

    return {
      reused: true,
      operation: existing,
    };
  }

  getIdempotencyKeyFromRequest(req: Request): string | undefined {
    return req.ctx?.idempotencyKey;
  }

  buildOperationCreateInput(input: {
    operationId: string;
    deploymentId: string;
    tenantId: string;
    customerId: string;
    type: DeploymentActionType;
    requestHash: string;
    idempotencyKey?: string;
    requestedStage?: AnyStage;
    source: OperationRecord['source'];
    actorId?: string;
    now?: string;
  }): OperationRecord {
    const now = input.now ?? new Date().toISOString();

    return {
      operationId: input.operationId,
      deploymentId: input.deploymentId,
      tenantId: input.tenantId,
      customerId: input.customerId,
      type: input.type,
      status: 'ACCEPTED',
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      requestedStage: input.requestedStage,
      source: input.source,
      actorId: input.actorId,
      createdAt: now,
      updatedAt: now,
    };
  }
}