import crypto from 'node:crypto';
import type { Request, Response } from 'express';

import { DeploymentOrchestratorService } from '../domain/deployments/deployment-orchestrator.service';
import {
  RedeployService,
  type RedeployMode,
} from '../domain/deployments/redeploy.service';
import { RetryPolicyService } from '../domain/deployments/retry-policy.service';
import { StagePreconditionsService } from '../domain/deployments/stage-preconditions.service';
import { IdempotencyService } from '../domain/idempotency/idempotency.service';

import { DeploymentsRepository } from '../repositories/deployments.repository';
import { OperationsRepository } from '../repositories/operations.repository';

import type {
  AnyStage,
  DeploymentRecord,
} from '../domain/deployments/types';

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

type RedeployBody = {
  mode?: RedeployMode;
};

function createOperationId(): string {
  return crypto.randomUUID();
}

function parseRedeployMode(input: unknown): RedeployMode {
  if (
    input === 'CONTENT_ONLY' ||
    input === 'REPAIR_INFRA' ||
    input === 'FULL_RECONCILE'
  ) {
    return input;
  }

  return 'CONTENT_ONLY';
}

export class DeploymentsActionsController {
  constructor(
    private readonly deploymentsRepository = new DeploymentsRepository(),
    private readonly operationsRepository = new OperationsRepository(),
    private readonly orchestrator = new DeploymentOrchestratorService(),
    private readonly redeployService = new RedeployService(),
    private readonly retryPolicyService = new RetryPolicyService(),
    private readonly stagePreconditionsService = new StagePreconditionsService(),
    private readonly idempotencyService = new IdempotencyService(),
    private readonly auditService = new AuditService(),
  ) {}

  redeployDeployment = async (
    req: Request<DeploymentParams, unknown, RedeployBody>,
    res: Response,
  ): Promise<void> => {
    const deploymentId = req.params.deploymentId;
    const mode = parseRedeployMode(req.body?.mode);

    const deployment = await this.requireDeployment(deploymentId);

    assertTenantAccess(deployment, req.ctx.tenantId);
    assertCanRedeploy(deployment);

    const existingOperations =
      await this.operationsRepository.listByDeploymentId(
        deployment.deploymentId,
      );
    assertNoBlockingOperation(existingOperations);

    const requestHash = this.idempotencyService.createRequestHash({
      type: 'REDEPLOY',
      tenantId: req.ctx.tenantId,
      customerId: deployment.customerId,
      deploymentId,
      body: { mode },
      path: req.originalUrl,
      method: req.method,
    });

    const existing = await this.idempotencyService.resolveExistingOperation({
      idempotencyKey: req.ctx.idempotencyKey,
      deploymentId,
      type: 'REDEPLOY',
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
        type: 'REDEPLOY',
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
      eventType: 'DEPLOYMENT_REDEPLOY_REQUESTED',
      metadata: { mode },
    });

    await this.auditService.write({
      deploymentId: deployment.deploymentId,
      operationId,
      tenantId: deployment.tenantId,
      customerId: deployment.customerId,
      actorId: req.ctx.actorId,
      eventType: 'OPERATION_ACCEPTED',
      metadata: {
        type: 'REDEPLOY',
        mode,
      },
    });

    void this.redeployService
      .startRedeploy(deployment.deploymentId, operationId, mode)
      .catch((error: unknown) => {
        console.error(
          `[REDEPLOY][${deployment.deploymentId}][${operationId}]`,
          error,
        );
      });

    res.status(202).json({
      data: {
        operationId,
        deploymentId: deployment.deploymentId,
        mode,
        status: 'REDEPLOY_STARTED',
      },
      requestId: req.ctx.requestId,
    });
  };

  retryStage = async (
    req: Request<RetryStageParams>,
    res: Response,
  ): Promise<void> => {
    const deploymentId = req.params.deploymentId;
    const stage = req.params.stage;

    const deployment = await this.requireDeployment(deploymentId);

    assertTenantAccess(deployment, req.ctx.tenantId);
    assertCanRetryStage(deployment, stage);

    const stageState = deployment.stageStates[stage];
    const retryDecision = this.retryPolicyService.canRetry(stage, stageState);

    if (!retryDecision.allowed) {
      res.status(409).json({
        error: 'Stage cannot be retried',
        reason: retryDecision.reason,
        stage,
        requestId: req.ctx.requestId,
      });
      return;
    }

    this.stagePreconditionsService.assertStageCanRun(deployment, stage);

    const existingOperations =
      await this.operationsRepository.listByDeploymentId(
        deployment.deploymentId,
      );
    assertNoBlockingOperation(existingOperations);

    const requestHash = this.idempotencyService.createRequestHash({
      type: 'RETRY_STAGE',
      tenantId: req.ctx.tenantId,
      customerId: deployment.customerId,
      deploymentId,
      requestedStage: stage,
      body: { stage },
      path: req.originalUrl,
      method: req.method,
    });

    const existing = await this.idempotencyService.resolveExistingOperation({
      idempotencyKey: req.ctx.idempotencyKey,
      deploymentId,
      type: 'RETRY_STAGE',
      requestHash,
      requestedStage: stage,
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
        type: 'RETRY_STAGE',
        requestHash,
        idempotencyKey: req.ctx.idempotencyKey,
        requestedStage: stage,
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
      metadata: {
        type: 'RETRY_STAGE',
        stage,
      },
    });

    void this.runRetryFlow(deployment, operationId, stage).catch(
      (error: unknown) => {
        console.error(
          `[RETRY_STAGE][${deployment.deploymentId}][${operationId}][${stage}]`,
          error,
        );
      },
    );

    res.status(202).json({
      data: {
        operationId,
        deploymentId: deployment.deploymentId,
        stage,
        status: 'RETRY_STAGE_STARTED',
        nextRetryCount: retryDecision.nextRetryCount,
        followUpStages:
          this.retryPolicyService.getDependentFollowUpStages(stage),
      },
      requestId: req.ctx.requestId,
    });
  };

  listDeploymentOperations = async (
    req: Request<DeploymentParams>,
    res: Response,
  ): Promise<void> => {
    const deployment = await this.requireDeployment(req.params.deploymentId);

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

  private async runRetryFlow(
    deployment: DeploymentRecord,
    operationId: string,
    stage: AnyStage,
  ): Promise<void> {
    await this.orchestrator.runSingleStage(
      deployment.deploymentId,
      operationId,
      stage,
    );

    const followUpStages =
      this.retryPolicyService.getDependentFollowUpStages(stage);

    for (const followUpStage of followUpStages) {
      const refreshed = await this.requireDeployment(deployment.deploymentId);
      this.stagePreconditionsService.assertStageCanRun(
        refreshed,
        followUpStage,
      );

      await this.orchestrator.runSingleStage(
        deployment.deploymentId,
        operationId,
        followUpStage,
      );
    }
  }

  private async requireDeployment(
    deploymentId: string,
  ): Promise<DeploymentRecord> {
    const deployment = await this.deploymentsRepository.getById(deploymentId);

    if (!deployment) {
      throw new NotFoundError('Deployment not found');
    }

    return deployment;
  }
}