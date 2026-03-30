import type { Request, Response } from 'express';
import { OperationsRepository } from '../repositories/operations.repository';
import { DeploymentsRepository } from '../repositories/deployments.repository';
import { NotFoundError } from '../errors/app-error';

type OperationParams = {
  operationId: string;
};

export class OperationsController {
  constructor(
    private readonly operationsRepository = new OperationsRepository(),
    private readonly deploymentsRepository = new DeploymentsRepository(),
  ) {}

  getOperation = async (
    req: Request<OperationParams>,
    res: Response,
  ): Promise<void> => {
    const operation = await this.operationsRepository.getById(
      req.params.operationId,
    );

    if (!operation) {
      throw new NotFoundError('Operation not found');
    }

    if (operation.tenantId !== req.ctx.tenantId) {
      throw new NotFoundError('Operation not found');
    }

    const deployment = await this.deploymentsRepository.getById(
      operation.deploymentId,
    );

    res.status(200).json({
      data: {
        operation,
        deployment: deployment
          ? {
              deploymentId: deployment.deploymentId,
              status: deployment.status,
              currentStage: deployment.currentStage ?? null,
              lastSuccessfulStage: deployment.lastSuccessfulStage ?? null,
              failureStage: deployment.failureStage ?? null,
              updatedAt: deployment.updatedAt,
            }
          : null,
      },
      requestId: req.ctx.requestId,
    });
  };
}