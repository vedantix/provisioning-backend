import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { DeploymentOrchestratorService } from '../domain/deployments/deployment-orchestrator.service';
import { OperationsRepository } from '../repositories/operations.repository';
import { DeploymentsRepository } from '../repositories/deployments.repository';
import {
  assertNoBlockingOperation,
  assertTenantAccess,
} from '../domain/deployments/action-guards';
import { AuditService } from '../domain/audit/audit.service';
import { NotFoundError } from '../errors/app-error';

type ResumeParams = {
  deploymentId: string;
};

export class DeploymentsRunController {
  constructor(
    private readonly orchestrator = new DeploymentOrchestratorService(),
    private readonly operationsRepository = new OperationsRepository(),
    private readonly deploymentsRepository = new DeploymentsRepository(),
    private readonly auditService = new AuditService(),
  ) {}

  resumeDeployment = async (
    req: Request<ResumeParams>,
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
      type: 'RESUME',
      status: 'ACCEPTED',
      requestHash: `resume-${deployment.deploymentId}-${now}`,
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
      eventType: 'DEPLOYMENT_RESUME_REQUESTED',
    });

    await this.auditService.write({
      deploymentId: deployment.deploymentId,
      operationId,
      tenantId: deployment.tenantId,
      customerId: deployment.customerId,
      actorId: req.ctx.actorId,
      eventType: 'OPERATION_ACCEPTED',
      metadata: { type: 'RESUME' },
    });

    void this.orchestrator
      .resume(deployment.deploymentId, operationId)
      .catch(console.error);

    res.status(202).json({
      data: {
        operationId,
        deploymentId: deployment.deploymentId,
        status: 'RESUME_STARTED',
      },
      requestId: req.ctx.requestId,
    });
  };
}