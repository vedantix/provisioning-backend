import { Router } from 'express';
import { asyncHandler } from '../middleware/async-handler';
import { requireAdminAuthMiddleware } from '../middleware/require-admin-auth.middleware';
import { requireActorContextMiddleware } from '../middleware/require-actor-context.middleware';
import { BadRequestError, NotFoundError } from '../errors/app-error';
import { AnalyticsProvisionService } from '../services/analytics/analytics-provision.service';
import { EnvironmentValidationService } from '../services/analytics/environment-validation.service';
import { GoogleAnalyticsController } from '../services/analytics/google-analytics.controller';
import { CustomersRepository } from '../modules/customers/repositories/customers.repository';
import { DeploymentsRepository } from '../repositories/deployments.repository';
import { AnalyticsIntegrationsRepository } from '../repositories/analytics-integrations.repository';

const router = Router();
const analyticsService = new AnalyticsProvisionService();
const environmentValidationService = new EnvironmentValidationService();
const googleAnalyticsController = new GoogleAnalyticsController();
const customersRepository = new CustomersRepository();
const deploymentsRepository = new DeploymentsRepository();
const analyticsIntegrationsRepository = new AnalyticsIntegrationsRepository();

router.use(requireAdminAuthMiddleware);
router.use(requireActorContextMiddleware);

function readBodyString(body: unknown, key: string): string {
  const value = (body as Record<string, unknown> | undefined)?.[key];
  return typeof value === 'string' ? value.trim() : '';
}

async function resolveProvisionInput(req: any) {
  const customerId = readBodyString(req.body, 'customerId');

  if (!customerId) {
    throw new BadRequestError('customerId is required');
  }

  const customer = await customersRepository.getById(customerId);
  if (!customer || customer.tenantId !== req.ctx.tenantId) {
    throw new NotFoundError('Customer not found');
  }

  const requestedDeploymentId = readBodyString(req.body, 'deploymentId');
  const deploymentId =
    requestedDeploymentId || customer.deployment?.deploymentId || `analytics-${customer.id}`;
  const deployment = requestedDeploymentId
    ? await deploymentsRepository.getById(requestedDeploymentId)
    : customer.deployment?.deploymentId
      ? await deploymentsRepository.getById(customer.deployment.deploymentId)
      : null;

  if (deployment && deployment.tenantId !== req.ctx.tenantId) {
    throw new NotFoundError('Deployment not found');
  }

  return {
    tenantId: req.ctx.tenantId,
    actorId: req.ctx.actorId,
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

router.post(
  '/provision',
  asyncHandler(async (req, res) => {
    const input = await resolveProvisionInput(req);
    const result = await analyticsService.provisionAnalytics(input);

    res.status(200).json({
      data: result,
      requestId: req.ctx.requestId,
    });
  }),
);

router.post(
  '/provision-marketing-stack',
  asyncHandler(async (req, res) => {
    const input = await resolveProvisionInput(req);
    const result = await analyticsService.provisionAnalytics(input);

    res.status(200).json({
      data: result,
      requestId: req.ctx.requestId,
    });
  }),
);

router.post(
  '/repair',
  asyncHandler(async (req, res) => {
    const input = await resolveProvisionInput(req);
    const result = await analyticsService.repairAnalytics(input);

    res.status(200).json({
      data: result,
      requestId: req.ctx.requestId,
    });
  }),
);

router.post(
  '/retry',
  asyncHandler(async (req, res) => {
    const input = await resolveProvisionInput(req);
    const result = await analyticsService.repairAnalytics(input);

    res.status(200).json({
      data: result,
      requestId: req.ctx.requestId,
    });
  }),
);

router.get(
  '/environment/status',
  asyncHandler(async (req, res) => {
    res.status(200).json({
      data: environmentValidationService.validateMarketingStackEnvironment(),
      requestId: req.ctx.requestId,
    });
  }),
);

router.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const integrations = await analyticsIntegrationsRepository.listByTenantId(
      req.ctx.tenantId,
    );
    const providerReady = (status?: string) =>
      status === 'SUCCEEDED' || status === 'VERIFIED' || status === 'PROVISIONED';
    const summary = {
      total: integrations.length,
      ready: integrations.filter((item) =>
        providerReady(item.googleAnalytics.status) &&
        providerReady(item.searchConsole.status) &&
        providerReady(item.googleAds.status),
      ).length,
      failed: integrations.filter((item) => item.provisioningStatus === 'FAILED').length,
      running: integrations.filter((item) =>
        ['PENDING', 'RUNNING', 'RETRYING'].includes(item.provisioningStatus),
      ).length,
      missingTrackingEnvironment: integrations.filter(
        (item) => Object.keys(item.trackingEnvironment ?? {}).length === 0,
      ).length,
      providers: {
        googleAnalytics: integrations.filter((item) =>
          providerReady(item.googleAnalytics.status),
        ).length,
        searchConsole: integrations.filter((item) =>
          providerReady(item.searchConsole.status),
        ).length,
        googleAds: integrations.filter((item) =>
          providerReady(item.googleAds.status),
        ).length,
        clarity: integrations.filter((item) =>
          item.clarity.status === 'SUCCEEDED' || item.clarity.status === 'SKIPPED',
        ).length,
      },
      updatedAt: new Date().toISOString(),
    };

    res.status(200).json({
      data: summary,
      requestId: req.ctx.requestId,
    });
  }),
);

router.get(
  '/google-analytics/:customerId/status',
  asyncHandler(googleAnalyticsController.status),
);

router.post(
  '/google-analytics/:customerId/retry',
  asyncHandler(googleAnalyticsController.retry),
);

router.post(
  '/google-analytics/:customerId/reconnect',
  asyncHandler(googleAnalyticsController.reconnect),
);

router.delete(
  '/',
  asyncHandler(async (req, res) => {
    const customerId = readBodyString(req.body, 'customerId');

    if (!customerId) {
      throw new BadRequestError('customerId is required');
    }

    const result = await analyticsService.deleteAnalytics({
      tenantId: req.ctx.tenantId,
      customerId,
      deploymentId: readBodyString(req.body, 'deploymentId') || undefined,
      actorId: req.ctx.actorId,
    });

    res.status(200).json({
      data: result,
      requestId: req.ctx.requestId,
    });
  }),
);

router.get(
  '/:customerId/status',
  asyncHandler(async (req, res) => {
    const result = await analyticsService.getStatus(
      String(req.params.customerId),
      req.ctx.tenantId,
    );

    res.status(200).json({
      data: result,
      requestId: req.ctx.requestId,
    });
  }),
);

router.get(
  '/:customerId',
  asyncHandler(async (req, res) => {
    const result = await analyticsService.getAnalytics(
      String(req.params.customerId),
      req.ctx.tenantId,
    );

    res.status(200).json({
      data: result,
      requestId: req.ctx.requestId,
    });
  }),
);

export default router;
