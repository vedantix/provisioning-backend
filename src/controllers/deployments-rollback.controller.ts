import crypto from 'node:crypto';
import type { Request, Response } from 'express';

import { RollbackService } from '../domain/deployments/rollback.service';
import { IdempotencyService } from '../domain/idempotency/idempotency.service';

import { DeploymentsRepository } from '../repositories/deployments.repository';
import { OperationsRepository } from '../repositories/operations.repository';

import {
  assertCanRollback,
  assertNoBlockingOperation,
  assertTenantAccess,
} from '../domain/deployments/action-guards';

import { AuditService } from '../domain/audit/audit.service';
import { NotFoundError } from '../errors/app-error';

type RollbackParams = {
  deploymentId: string;
};

type RollbackBody = {
  targetRef?: string;
};

function createOperationId(): string {
  return crypto.randomUUID();
}

export class DeploymentsRollbackController {
  constructor(
    private readonly rollbackService = new RollbackService(),
    private readonly idempotencyService = new IdempotencyService(),
    private readonly deploymentsRepository = new DeploymentsRepository(),
    private readonly operationsRepository = new OperationsRepository(),
    private readonly auditService = new AuditService(),
  ) {}

  rollbackDeployment = async (
    req: Request<RollbackParams, unknown, RollbackBody>,
    res: Response,
  ): Promise<void> => {
    const deployment = await this.deploymentsRepository.getById(
      req.params.deploymentId,
    );

    if (!deployment) {
      throw new NotFoundError('Deployment not found');
    }

    assertTenantAccess(deployment, req.ctx.tenantId);
    assertCanRollback(deployment);

    const existingOperations =
      await this.operationsRepository.listByDeploymentId(
        deployment.deploymentId,
      );

    assertNoBlockingOperation(existingOperations);

    const requestHash = this.idempotencyService.createRequestHash({
      type: 'ROLLBACK',
      tenantId: req.ctx.tenantId,
      customerId: deployment.customerId,
      deploymentId: deployment.deploymentId,
      body: {
        action: 'ROLLBACK_DEPLOYMENT',
        targetRef: req.body?.targetRef ?? null,
      },
      path: req.originalUrl,
      method: req.method,
    });

    const existing = await this.idempotencyService.resolveExistingOperation({
      idempotencyKey: req.ctx.idempotencyKey,
      deploymentId: deployment.deploymentId,
      type: 'ROLLBACK',
      requestHash,
    });

    if (existing.reused) {
      res.status(existing.operation.status === 'RUNNING' ? 202 : 200).json({
        data: {
          reused: true,
          operation: existing.operation,
        },
        requestId: req.ctx.requestId,
      });
      return;
    }

    const operationId = createOperationId();

    await this.operationsRepository.create(
      this.idempotencyService.buildOperationCreateInput({
        operationId,
        deploymentId: deployment.deploymentId,
        tenantId: deployment.tenantId,
        customerId: deployment.customerId,
        type: 'ROLLBACK',
        requestHash,
        idempotencyKey: req.ctx.idempotencyKey,
        source: req.ctx.source,
        actorId: req.ctx.actorId,
      }),
    );

    await this.auditService.write({
      deploymentId: deployment.deploymentId,
      operationId,
      tenantId: deployment.tenantId,
      customerId: deployment.customerId,
      actorId: req.ctx.actorId,
      eventType: 'OPERATION_ACCEPTED',
      metadata: {
        type: 'ROLLBACK',
        targetRef: req.body?.targetRef ?? null,
      },
    });

    void this.rollbackService
      .rollback(deployment.deploymentId, operationId, {
        targetRef: req.body?.targetRef,
        actorId: req.ctx.actorId,
      })
      .catch((error: unknown) => {
        console.error(
          `[ROLLBACK][${deployment.deploymentId}][${operationId}]`,
          error,
        );
      });

    res.status(202).json({
      data: {
        operationId,
        deploymentId: deployment.deploymentId,
        targetRef: req.body?.targetRef ?? null,
        status: 'ROLLBACK_STARTED',
      },
      requestId: req.ctx.requestId,
    });
  };
}