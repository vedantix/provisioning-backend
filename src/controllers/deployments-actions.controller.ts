import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { DeploymentOrchestratorService } from '../domain/deployments/deployment-orchestrator.service';
import { RedeployService } from '../domain/deployments/redeploy.service';
import { DeploymentsRepository } from '../repositories/deployments.repository';
import { OperationsRepository } from '../repositories/operations.repository';
import type { AnyStage } from '../domain/deployments/types';
import {
  assertCanRedeploy,
  assertCanRetryStage,
  assertNoBlockingOperation,
  assertTenantAccess,
} from '../domain/deployments/action-guards';
import { AuditService } from '../domain/audit/audit.service';
import { NotFoundError } from '../errors/app-error';

type DeploymentParams = {
  deploymentId: string;
};

type RetryStageParams = {
  deploymentId: string;
  stage: AnyStage;
};

export class DeploymentsActionsController {
  constructor(
    private readonly deploymentsRepository = new DeploymentsRepository(),
    private readonly operationsRepository = new OperationsRepository(),
    private readonly orchestrator = new DeploymentOrchestratorService(),
    private readonly redeployService = new RedeployService(),
    private readonly auditService = new AuditService(),
  ) {}

  redeployDeployment = async (
    req: Request<DeploymentParams>,
    res: Response,
  ): Promise<void> => {
    const deployment = await this.deploymentsRepository.getById(
      req.params.deploymentId,
    );

    if (!deployment) {
      throw new NotFoundError('Deployment not found');
    }

    assertTenantAccess(deployment, req.ctx.tenantId);
    assertCanRedeploy(deployment);

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
      type: 'REDEPLOY',
      status: 'ACCEPTED',
      requestHash: `redeploy-${deployment.deploymentId}-${now}`,
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
      eventType: 'DEPLOYMENT_REDEPLOY_REQUESTED',
    });

    await this.auditService.write({
      deploymentId: deployment.deploymentId,
      operationId,
      tenantId: deployment.tenantId,
      customerId: deployment.customerId,
      actorId: req.ctx.actorId,
      eventType: 'OPERATION_ACCEPTED',
      metadata: { type: 'REDEPLOY' },
    });

    void this.redeployService
      .startSoftRedeploy(deployment.deploymentId, operationId)
      .catch(console.error);

    res.status(202).json({
      data: {
        operationId,
        deploymentId: deployment.deploymentId,
        status: 'REDEPLOY_STARTED',
      },
      requestId: req.ctx.requestId,
    });
  };

  retryStage = async (
    req: Request<RetryStageParams>,
    res: Response,
  ): Promise<void> => {
    const deployment = await this.deploymentsRepository.getById(
      req.params.deploymentId,
    );

    if (!deployment) {
      throw new NotFoundError('Deployment not found');
    }

    assertTenantAccess(deployment, req.ctx.tenantId);

    const stage = req.params.stage;
    assertCanRetryStage(deployment, stage);

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
      type: 'RETRY_STAGE',
      status: 'ACCEPTED',
      requestHash: `retry-${deployment.deploymentId}-${stage}-${now}`,
      requestedStage: stage,
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
      eventType: 'DEPLOYMENT_RETRY_STAGE_REQUESTED',
      metadata: { stage },
    });

    await this.auditService.write({
      deploymentId: deployment.deploymentId,
      operationId,
      tenantId: deployment.tenantId,
      customerId: deployment.customerId,
      actorId: req.ctx.actorId,
      eventType: 'OPERATION_ACCEPTED',
      metadata: { type: 'RETRY_STAGE', stage },
    });

    void this.orchestrator
      .runSingleStage(deployment.deploymentId, operationId, stage)
      .catch(console.error);

    res.status(202).json({
      data: {
        operationId,
        deploymentId: deployment.deploymentId,
        stage,
        status: 'RETRY_STAGE_STARTED',
      },
      requestId: req.ctx.requestId,
    });
  };

  listDeploymentOperations = async (
    req: Request<DeploymentParams>,
    res: Response,
  ): Promise<void> => {
    const deployment = await this.deploymentsRepository.getById(
      req.params.deploymentId,
    );

    if (!deployment) {
      throw new NotFoundError('Deployment not found');
    }

    assertTenantAccess(deployment, req.ctx.tenantId);

    const operations = await this.operationsRepository.listByDeploymentId(
      deployment.deploymentId,
    );

    res.status(200).json({
      data: {
        deploymentId: deployment.deploymentId,
        operations,
      },
      requestId: req.ctx.requestId,
    });
  };
}