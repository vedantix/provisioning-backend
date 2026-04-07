import crypto from 'node:crypto';
import type {
  DeploymentRecord,
  NormalizedCreateDeploymentInput,
  OperationRecord,
} from './types';
import { createDeploymentRequestHash } from './request-hash';
import { DeploymentsRepository } from '../../repositories/deployments.repository';
import { OperationsRepository } from '../../repositories/operations.repository';

export class ConflictError extends Error {
  statusCode = 409;

  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

export class IdempotencyService {
  constructor(
    private readonly operationsRepository = new OperationsRepository(),
    private readonly deploymentsRepository = new DeploymentsRepository(),
  ) {}

  async assertCreateAllowed(input: NormalizedCreateDeploymentInput): Promise<void> {
    const activeDeployment = await this.deploymentsRepository.findActiveByTenantAndDomain(
      input.tenantId,
      input.domain,
    );

    if (activeDeployment) {
      throw new ConflictError(
        `Active deployment already exists for domain ${input.domain}`,
      );
    }
  }

  async getExistingOperationForKey(
    idempotencyKey: string,
    requestHash: string,
  ): Promise<OperationRecord | null> {
    const existing = await this.operationsRepository.findByIdempotencyKey(idempotencyKey);

    if (!existing) {
      return null;
    }

    if (existing.requestHash !== requestHash) {
      throw new ConflictError(
        'Idempotency key already used with a different request payload',
      );
    }

    return existing;
  }

  buildCreateDeploymentRequestHash(
    input: NormalizedCreateDeploymentInput,
  ): string {
    return createDeploymentRequestHash(input);
  }

  createAcceptedOperation(params: {
    deploymentId: string;
    requestHash: string;
    input: NormalizedCreateDeploymentInput;
  }): OperationRecord {
    const now = new Date().toISOString();

    return {
      operationId: crypto.randomUUID(),
      deploymentId: params.deploymentId,
      tenantId: params.input.tenantId,
      customerId: params.input.customerId,
      type: 'CREATE',
      status: 'ACCEPTED',
      idempotencyKey: params.input.idempotencyKey,
      requestHash: params.requestHash,
      source: params.input.source,
      actorId: params.input.triggeredBy ?? params.input.createdBy,
      createdAt: now,
      updatedAt: now,
    };
  }

  createPendingDeployment(params: {
    deploymentId: string;
    requestHash: string;
    input: NormalizedCreateDeploymentInput;
  }): DeploymentRecord & { id: string } {
    const now = new Date().toISOString();
  
    return {
      id: params.deploymentId,
      deploymentId: params.deploymentId,
      tenantId: params.input.tenantId,
      customerId: params.input.customerId,
      actionType: 'CREATE',
      status: 'PENDING',
      domain: params.input.domain,
      rootDomain: params.input.rootDomain,
      packageCode: params.input.packageCode,
      addOns: params.input.addOns,
      idempotencyKey: params.input.idempotencyKey,
      requestHash: params.requestHash,
      currentStage: undefined,
      lastSuccessfulStage: undefined,
      failureStage: undefined,
      stageStates: {},
      managedResources: {},
      domainBindings: [
        {
          domain: params.input.domain,
          rootDomain: params.input.rootDomain,
          type: 'PRIMARY',
          status: 'PENDING',
          certificateCovered: false,
          route53Linked: false,
          createdAt: now,
        },
      ],
      source: params.input.source,
      createdBy: params.input.createdBy,
      triggeredBy: params.input.triggeredBy,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
  }
}