import type { Request, Response } from 'express';
import { TestResourceCleanupService } from '../domain/cleanup/test-resource-cleanup.service';
import { OrphanGuardService } from '../domain/guardrails/orphan-guard.service';
import { ResourceReconcilerService } from '../domain/guardrails/resource-reconciler.service';
import { DeploymentsRepository } from '../repositories/deployments.repository';
import { assertTenantAccess } from '../domain/deployments/action-guards';
import { NotFoundError } from '../errors/app-error';

type DeploymentParams = {
  deploymentId: string;
};

export class AdminCleanupController {
  constructor(
    private readonly cleanupService = new TestResourceCleanupService(),
    private readonly orphanGuardService = new OrphanGuardService(),
    private readonly reconcilerService = new ResourceReconcilerService(),
    private readonly deploymentsRepository = new DeploymentsRepository(),
  ) {}

  listCleanupCandidates = async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    const items = await this.cleanupService.listCandidates();

    const tenantScoped = items.filter(
      (item) => item.tenantId === req.ctx.tenantId,
    );

    res.status(200).json({
      data: {
        items: tenantScoped,
        count: tenantScoped.length,
      },
      requestId: req.ctx.requestId,
    });
  };

  runCleanup = async (req: Request, res: Response): Promise<void> => {
    const limitRaw = req.body?.limit;
    const limit =
      typeof limitRaw === 'number'
        ? limitRaw
        : typeof limitRaw === 'string'
          ? Number.parseInt(limitRaw, 10)
          : 25;

    const result = await this.cleanupService.runCleanup(
      Number.isFinite(limit) ? limit : 25,
    );

    res.status(202).json({
      data: result,
      requestId: req.ctx.requestId,
    });
  };

  scanOrphans = async (req: Request, res: Response): Promise<void> => {
    const limitRaw = req.query.limit;
    const limit =
      typeof limitRaw === 'string' ? Number.parseInt(limitRaw, 10) : 100;

    const candidates = await this.cleanupService.listCandidates();
    const tenantScopedCandidates = candidates
      .filter((item) => item.tenantId === req.ctx.tenantId)
      .slice(0, Number.isFinite(limit) ? limit : 100);

    const findings = [];

    for (const candidate of tenantScopedCandidates) {
      const deploymentFindings = await this.orphanGuardService.scanDeployment(
        candidate.deploymentId,
      );

      findings.push(...deploymentFindings);
    }

    res.status(200).json({
      data: {
        items: findings,
        count: findings.length,
      },
      requestId: req.ctx.requestId,
    });
  };

  reconcileDeployment = async (
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

    const result = await this.reconcilerService.reconcileDeployment(
      deployment.deploymentId,
    );

    res.status(200).json({
      data: result,
      requestId: req.ctx.requestId,
    });
  };

  checkConsistency = async (
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

    const result = await this.reconcilerService.reconcileDeployment(
      deployment.deploymentId,
    );

    res.status(200).json({
      data: {
        deploymentId: result.deploymentId,
        ok: result.ok,
        driftDetected: result.driftDetected,
        consistency: result.consistency,
      },
      requestId: req.ctx.requestId,
    });
  };
}