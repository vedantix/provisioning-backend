import type { Request, Response } from 'express';
import { DeploymentsRepository } from '../repositories/deployments.repository';
import { AuditRepository } from '../repositories/audit.repository';
import { NotFoundError } from '../errors/app-error';

type DeploymentParams = {
  deploymentId: string;
};

export class DeploymentsAuditController {
  constructor(
    private readonly deploymentsRepository = new DeploymentsRepository(),
    private readonly auditRepository = new AuditRepository(),
  ) {}

  listAuditEvents = async (
    req: Request<DeploymentParams>,
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

    const events = await this.auditRepository.listByDeploymentId(
      deployment.deploymentId,
    );

    res.status(200).json({
      data: {
        deploymentId: deployment.deploymentId,
        events,
      },
      requestId: req.ctx.requestId,
    });
  };
}