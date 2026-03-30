import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { normalizeCreateDeploymentInput } from '../domain/deployments/request-normalizer';
import { IdempotencyService, ConflictError } from '../domain/deployments/idempotency.service';
import { DeploymentsRepository } from '../repositories/deployments.repository';
import { OperationsRepository } from '../repositories/operations.repository';
import { ConflictHttpError, NotFoundError } from '../errors/app-error';

type GetDeploymentParams = {
  deploymentId: string;
};

export class DeploymentsController {
  constructor(
    private readonly idempotencyService = new IdempotencyService(),
    private readonly deploymentsRepository = new DeploymentsRepository(),
    private readonly operationsRepository = new OperationsRepository(),
  ) {}

  createDeployment = async (req: Request, res: Response): Promise<void> => {
    const input = normalizeCreateDeploymentInput({
      customerId: req.body.customerId,
      tenantId: req.ctx.tenantId,
      projectName: req.body.projectName,
      domain: req.body.domain,
      packageCode: req.body.packageCode,
      addOns: req.body.addOns,
      source: req.ctx.source,
      createdBy: req.ctx.actorId,
      triggeredBy: req.ctx.actorId,
      idempotencyKey: req.ctx.idempotencyKey,
    });

    const requestHash =
      this.idempotencyService.buildCreateDeploymentRequestHash(input);

    if (input.idempotencyKey) {
      const existingOperation =
        await this.idempotencyService.getExistingOperationForKey(
          input.idempotencyKey,
          requestHash,
        );

      if (existingOperation) {
        res.status(200).json({
          data: {
            reused: true,
            operationId: existingOperation.operationId,
            deploymentId: existingOperation.deploymentId,
            status: existingOperation.status,
          },
          requestId: req.ctx.requestId,
        });
        return;
      }
    }

    try {
      await this.idempotencyService.assertCreateAllowed(input);
    } catch (error) {
      if (error instanceof ConflictError) {
        throw new ConflictHttpError(error.message);
      }
      throw error;
    }

    const deploymentId = crypto.randomUUID();

    const deployment = this.idempotencyService.createPendingDeployment({
      deploymentId,
      requestHash,
      input,
    });

    const operation = this.idempotencyService.createAcceptedOperation({
      deploymentId,
      requestHash,
      input,
    });

    await this.deploymentsRepository.create(deployment);
    await this.operationsRepository.create(operation);

    const { AuditService } = await import('../domain/audit/audit.service');
    const auditService = new AuditService();

    await auditService.write({
      deploymentId,
      operationId: operation.operationId,
      tenantId: deployment.tenantId,
      customerId: deployment.customerId,
      actorId: req.ctx.actorId,
      eventType: 'DEPLOYMENT_CREATED',
      metadata: {
        domain: deployment.domain,
        packageCode: deployment.packageCode,
      },
    });

    await auditService.write({
      deploymentId,
      operationId: operation.operationId,
      tenantId: deployment.tenantId,
      customerId: deployment.customerId,
      actorId: req.ctx.actorId,
      eventType: 'OPERATION_ACCEPTED',
      metadata: { type: 'CREATE' },
    });

    void import('../domain/deployments/deployment-orchestrator.service').then(
      async ({ DeploymentOrchestratorService }) => {
        const orchestrator = new DeploymentOrchestratorService();
        await orchestrator.runCreate(deploymentId, operation.operationId);
      },
    );

    res.status(202).json({
      data: {
        deploymentId,
        operationId: operation.operationId,
        status: deployment.status,
        currentStage: deployment.currentStage ?? null,
      },
      requestId: req.ctx.requestId,
    });
  };

  getDeployment = async (
    req: Request<GetDeploymentParams>,
    res: Response,
  ): Promise<void> => {
    const deployment = await this.deploymentsRepository.getById(
      req.params.deploymentId,
    );

    if (!deployment) {
      throw new NotFoundError('Deployment not found');
    }

    if (deployment.tenantId !== req.ctx.tenantId) {
      throw new NotFoundError('Deployment not found');
    }

    res.status(200).json({
      data: deployment,
      requestId: req.ctx.requestId,
    });
  };
}