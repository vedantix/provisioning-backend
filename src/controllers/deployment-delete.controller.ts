import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { DeleteDeploymentService } from '../domain/deployments/delete-deployment.service';
import { DeploymentsRepository } from '../repositories/deployments.repository';
import { OperationsRepository } from '../repositories/operations.repository';
import {
  assertNoBlockingOperation,
  assertTenantAccess,
} from '../domain/deployments/action-guards';
import { AuditService } from '../domain/audit/audit.service';
import { NotFoundError } from '../errors/app-error';

type DeleteParams = {
  deploymentId: string;
};

export class DeploymentsDeleteController {
  constructor(
    private readonly deleteService = new DeleteDeploymentService(),
    private readonly deploymentsRepository = new DeploymentsRepository(),
    private readonly operationsRepository = new OperationsRepository(),
    private readonly auditService = new AuditService(),
  ) {}

  deleteDeployment = async (
    req: Request<DeleteParams>,
    res: Response,
  ): Promise<void> => {
    const deployment = await this.deploymentsRepository.getById(
      req.params.deploymentId,
    );

    if (!deployment) {
      throw new NotFoundError('Deployment not found');
    }

    assertTenantAccess(deployment, req.ctx.tenantId);

    const existingOperations = await this.operationsRepository.listByDeploymentId(
      deployment.deploymentId,
    );
    assertNoBlockingOperation(existingOperations);

    const operationId = crypto.randomUUID();
    const now = new Date().toISOString();

    await this.operationsRepository.create({
      operationId,
      deploymentId: deployment.deploymentId,
      tenantId: deployment.tenantId,
      customerId: deployment.customerId,
      type: 'DELETE',
      status: 'ACCEPTED',
      requestHash: `delete-${deployment.deploymentId}-${now}`,
      source: req.ctx.source,
      actorId: req.ctx.actorId,
      createdAt: now,
      updatedAt: now,
    });

    await this.auditService.write({
      deploymentId: deployment.deploymentId,
      operationId,
      tenantId: deployment.tenantId,
      customerId: deployment.customerId,
      actorId: req.ctx.actorId,
      eventType: 'DEPLOYMENT_DELETE_REQUESTED',
    });

    await this.auditService.write({
      deploymentId: deployment.deploymentId,
      operationId,
      tenantId: deployment.tenantId,
      customerId: deployment.customerId,
      actorId: req.ctx.actorId,
      eventType: 'OPERATION_ACCEPTED',
      metadata: { type: 'DELETE' },
    });

    void this.deleteService
      .runDelete(deployment.deploymentId, operationId)
      .catch(console.error);

    res.status(202).json({
      data: {
        operationId,
        deploymentId: deployment.deploymentId,
        status: 'DELETE_STARTED',
      },
      requestId: req.ctx.requestId,
    });
  };
}