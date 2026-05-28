import type { Request, Response } from 'express';
import { BadRequestError, NotFoundError } from '../../errors/app-error';
import { CustomersRepository } from '../../modules/customers/repositories/customers.repository';
import { DeploymentsRepository } from '../../repositories/deployments.repository';
import { AnalyticsProvisionService } from './analytics-provision.service';
import { GoogleAnalyticsRepository } from './google-analytics.repository';

function readBodyString(body: unknown, key: string): string {
  const value = (body as Record<string, unknown> | undefined)?.[key];
  return typeof value === 'string' ? value.trim() : '';
}

export class GoogleAnalyticsController {
  constructor(
    private readonly analyticsProvisionService = new AnalyticsProvisionService(),
    private readonly googleAnalyticsRepository = new GoogleAnalyticsRepository(),
    private readonly customersRepository = new CustomersRepository(),
    private readonly deploymentsRepository = new DeploymentsRepository(),
  ) {}

  status = async (req: Request, res: Response): Promise<void> => {
    const result = await this.googleAnalyticsRepository.getByCustomerId(
      String(req.params.customerId),
      req.ctx.tenantId,
    );

    res.status(200).json({
      data: result,
      requestId: req.ctx.requestId,
    });
  };

  retry = async (req: Request, res: Response): Promise<void> => {
    const input = await this.resolveProvisionInput(req);
    const result = await this.analyticsProvisionService.provisionGoogleAnalytics(input);

    res.status(200).json({
      data: result.googleAnalytics,
      requestId: req.ctx.requestId,
    });
  };

  reconnect = async (req: Request, res: Response): Promise<void> => {
    const input = await this.resolveProvisionInput(req);
    const current = await this.analyticsProvisionService.getStatus(
      input.customerId,
      input.tenantId,
    );

    if (current.googleAnalytics.status === 'SUCCEEDED') {
      await this.googleAnalyticsRepository.updateState({
        customerId: input.customerId,
        tenantId: input.tenantId,
        state: {
          ...current.googleAnalytics,
          status: 'RETRYING',
          errorMessage: undefined,
          updatedAt: new Date().toISOString(),
        },
      });
    }

    const result = await this.analyticsProvisionService.provisionGoogleAnalytics(input);

    res.status(200).json({
      data: result.googleAnalytics,
      requestId: req.ctx.requestId,
    });
  };

  private async resolveProvisionInput(req: Request) {
    const customerId =
      readBodyString(req.body, 'customerId') || String(req.params.customerId || '').trim();

    if (!customerId) {
      throw new BadRequestError('customerId is required');
    }

    const customer = await this.customersRepository.getById(customerId);
    if (!customer || customer.tenantId !== req.ctx.tenantId) {
      throw new NotFoundError('Customer not found');
    }

    const requestedDeploymentId = readBodyString(req.body, 'deploymentId');
    const deploymentId =
      requestedDeploymentId || customer.deployment?.deploymentId || `analytics-${customer.id}`;
    const deployment = requestedDeploymentId
      ? await this.deploymentsRepository.getById(requestedDeploymentId)
      : customer.deployment?.deploymentId
        ? await this.deploymentsRepository.getById(customer.deployment.deploymentId)
        : null;

    if (deployment && deployment.tenantId !== req.ctx.tenantId) {
      throw new NotFoundError('Deployment not found');
    }

    return {
      tenantId: req.ctx.tenantId,
      actorId: req.ctx.actorId,
      requestId: req.ctx.requestId,
      idempotencyKey: req.ctx.idempotencyKey,
      customerId: customer.id,
      deploymentId,
      domain: readBodyString(req.body, 'domain') || customer.domain,
      displayName:
        readBodyString(req.body, 'displayName') || customer.companyName || customer.domain,
      hostedZoneId:
        readBodyString(req.body, 'hostedZoneId') ||
        deployment?.managedResources.hostedZoneId,
    };
  }
}
