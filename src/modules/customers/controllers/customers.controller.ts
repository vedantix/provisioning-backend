import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { CustomersService } from '../services/customers.service';
import { CustomerBase44Service } from '../services/customer-base44.service';
import { Base44AutoCreateService } from '../../base44/services/base44-autocreate.service';
import { normalizeCreateDeploymentInput } from '../../../domain/deployments/request-normalizer';
import {
  IdempotencyService,
  ConflictError,
} from '../../../domain/deployments/idempotency.service';
import { DeploymentsRepository } from '../../../repositories/deployments.repository';
import { OperationsRepository } from '../../../repositories/operations.repository';
import { ConflictHttpError } from '../../../errors/app-error';
import { MailProvisioningService } from '../../mail/services/mail-provisioning.service';
import { FinanceService } from '../../finance/services/finance.service';
import type { PackageCode } from '../../mail/types/mail.types';
import { ContentSyncService } from '../../content-sync/services/content-sync.service';
import { CustomerBuildFlowService } from '../../customer-workflow/services/customer-build-flow.service';

function getSingleParam(value: string | string[] | undefined, name: string): string {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }

  if (Array.isArray(value) && value.length > 0 && value[0]?.trim()) {
    return value[0].trim();
  }

  throw new Error(`[CUSTOMERS_CONTROLLER] Missing or invalid route param: ${name}`);
}

function toPackageCode(value: string): PackageCode {
  const normalized = String(value || '').trim().toUpperCase();

  if (
    normalized === 'STARTER' ||
    normalized === 'GROWTH' ||
    normalized === 'PRO' ||
    normalized === 'CUSTOM'
  ) {
    return normalized as PackageCode;
  }

  throw new Error(`Unsupported package code for mail provisioning: ${value}`);
}

function parseAdditionalFiles(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => ({
      path: String(item.path || '').trim(),
      content: String(item.content || ''),
      encoding: item.encoding === 'base64' ? 'base64' as const : 'utf-8' as const,
    }))
    .filter((item) => item.path.length > 0);
}

function buildBase44Prompt(params: {
  companyName: string;
  domain: string;
  packageCode: string;
  niche?: string;
  templateKey?: string;
  city?: string;
  extras?: string[];
}): string {
  return [
    `Maak een conversiegerichte website voor ${params.companyName} in Nederland.`,
    params.niche ? `Niche: ${params.niche}.` : '',
    params.city ? `Vestigingsplaats: ${params.city}.` : '',
    params.packageCode ? `Pakket: ${params.packageCode}.` : '',
    params.templateKey ? `Template key: ${params.templateKey}.` : '',
    params.extras?.length ? `Extra's: ${params.extras.join(', ')}.` : '',
    `Gebruik domeincontext: ${params.domain}.`,
    'Gebruik een professionele homepage met hero, diensten, reviews, FAQ, contact en duidelijke CTA’s.',
    'De site is bedoeld als klantpreview en moet later op een eigen domein live kunnen.',
  ]
    .filter(Boolean)
    .join(' ');
}

function ensureHasBase44Linked(customer: any): void {
  if (!customer?.base44?.appId) {
    throw new ConflictHttpError('Base44 app is nog niet gekoppeld voor deze klant.');
  }
}

function ensureHasPreview(customer: any): void {
  if (!customer?.base44?.previewUrl) {
    throw new ConflictHttpError('Preview URL ontbreekt. Zet eerst een preview klaar.');
  }
}

function ensurePreviewReady(customer: any): void {
  if (
    customer?.websiteBuildStatus !== 'PREVIEW_READY' &&
    customer?.websiteBuildStatus !== 'APPROVED_FOR_PRODUCTION' &&
    customer?.websiteBuildStatus !== 'LIVE'
  ) {
    throw new ConflictHttpError('Preview is nog niet klaar voor review.');
  }
}

function ensureApprovedForProduction(customer: any): void {
  if (
    customer?.websiteBuildStatus !== 'APPROVED_FOR_PRODUCTION' &&
    customer?.websiteBuildStatus !== 'LIVE'
  ) {
    throw new ConflictHttpError('Klant is nog niet goedgekeurd voor productie.');
  }
}

function ensureContentSynced(customer: any): void {
  if (
    customer?.contentSync?.status !== 'SYNCED' ||
    !customer?.contentSync?.repositoryName
  ) {
    throw new ConflictHttpError('Content is nog niet naar GitHub gesynchroniseerd.');
  }
}

export class CustomersController {
  constructor(
    private readonly customersService = new CustomersService(),
    private readonly customerBase44Service = new CustomerBase44Service(),
    private readonly base44AutoCreateService = new Base44AutoCreateService(),
    private readonly idempotencyService = new IdempotencyService(),
    private readonly deploymentsRepository = new DeploymentsRepository(),
    private readonly operationsRepository = new OperationsRepository(),
    private readonly mailProvisioningService = new MailProvisioningService(),
    private readonly financeService = new FinanceService(),
    private readonly contentSyncService = new ContentSyncService(),
    private readonly customerBuildFlowService = new CustomerBuildFlowService(),
  ) {}

  createCustomer = async (req: Request, res: Response): Promise<void> => {
    const customer = await this.customersService.createCustomer({
      tenantId: req.ctx.tenantId,
      createdBy: req.ctx.actorId,
      ...req.body,
    });

    res.status(201).json({ data: customer, requestId: req.ctx.requestId });
  };

  listCustomers = async (req: Request, res: Response): Promise<void> => {
    const customers = await this.customersService.listCustomers(req.ctx.tenantId);
    res.status(200).json({ data: customers, requestId: req.ctx.requestId });
  };

  getCustomer = async (req: Request, res: Response): Promise<void> => {
    const customerId = getSingleParam(req.params.customerId, 'customerId');
    const customer = await this.customersService.getCustomerById(req.ctx.tenantId, customerId);

    if (!customer) {
      res.status(404).json({ error: 'Customer not found', requestId: req.ctx.requestId });
      return;
    }

    res.status(200).json({ data: customer, requestId: req.ctx.requestId });
  };

  updateCustomer = async (req: Request, res: Response): Promise<void> => {
    const customerId = getSingleParam(req.params.customerId, 'customerId');
    const existing = await this.customersService.getCustomerById(req.ctx.tenantId, customerId);

    if (!existing) {
      res.status(404).json({ error: 'Customer not found', requestId: req.ctx.requestId });
      return;
    }

    const updated = await this.customersService.updateCustomer({
      tenantId: req.ctx.tenantId,
      actorId: req.ctx.actorId,
      customerId,
      payload: req.body,
    });

    res.status(200).json({ data: updated, requestId: req.ctx.requestId });
  };

  deleteCustomer = async (req: Request, res: Response): Promise<void> => {
    const customerId = getSingleParam(req.params.customerId, 'customerId');
    const updated = await this.customersService.softDeleteCustomer({
      tenantId: req.ctx.tenantId,
      actorId: req.ctx.actorId,
      customerId,
    });

    await this.financeService
      .deleteCustomerFinance({
        tenantId: req.ctx.tenantId,
        customerId,
      })
      .catch((error) => {
        console.error('[CUSTOMER_FINANCE_DELETE_FAILED]', {
          customerId,
          tenantId: req.ctx.tenantId,
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      });

    res.status(200).json({ data: updated, requestId: req.ctx.requestId });
  };

  startBuildFlow = async (req: Request, res: Response): Promise<void> => {
    const customerId = getSingleParam(req.params.customerId, 'customerId');
    const customer = await this.customersService.getCustomerById(req.ctx.tenantId, customerId);
    if (!customer) {
      res.status(404).json({ error: 'Customer not found', requestId: req.ctx.requestId });
      return;
    }
    const result = await this.customerBuildFlowService.startFlow(customer, {
      tenantId: req.ctx.tenantId,
      actorId: req.ctx.actorId,
      customerId,
      ...req.body,
      additionalFiles: Array.isArray(req.body.additionalFiles) ? req.body.additionalFiles : [],
    });
    res.status(200).json({ data: result, requestId: req.ctx.requestId });
  };

  autoCreateBase44App = async (req: Request, res: Response): Promise<void> => {
    const customerId = getSingleParam(req.params.customerId, 'customerId');
    const customer = await this.customersService.getCustomerById(req.ctx.tenantId, customerId);

    if (!customer) {
      res.status(404).json({ error: 'Customer not found', requestId: req.ctx.requestId });
      return;
    }

    const requestedPrompt =
      String(req.body.requestedPrompt || '').trim() ||
      buildBase44Prompt({
        companyName: customer.companyName,
        domain: customer.domain,
        packageCode: customer.packageCode,
        niche: req.body.niche || customer.niche,
        templateKey: req.body.templateKey || customer.templateKey,
        city: customer.city,
        extras: customer.extras,
      });

    const result = await this.base44AutoCreateService.createApp({
      customerId: customer.id,
      companyName: customer.companyName,
      domain: customer.domain,
      packageCode: customer.packageCode,
      niche: String(req.body.niche || customer.niche || '').trim() || undefined,
      templateKey: String(req.body.templateKey || customer.templateKey || '').trim() || undefined,
      prompt: requestedPrompt,
    });

    const updated = await this.customerBase44Service.linkExistingApp(
      customer,
      {
        tenantId: req.ctx.tenantId,
        customerId: customer.id,
        actorId: req.ctx.actorId,
        appId: result.appId,
        appName: result.appName,
        editorUrl: result.editorUrl,
        previewUrl: result.previewUrl,
        templateKey: String(req.body.templateKey || customer.templateKey || '').trim() || undefined,
        niche: String(req.body.niche || customer.niche || '').trim() || undefined,
        requestedPrompt,
      },
    );

    res.status(200).json({ data: updated, requestId: req.ctx.requestId });
  };

  linkBase44App = async (req: Request, res: Response): Promise<void> => {
    const customerId = getSingleParam(req.params.customerId, 'customerId');
    const customer = await this.customersService.getCustomerById(req.ctx.tenantId, customerId);

    if (!customer) {
      res.status(404).json({ error: 'Customer not found', requestId: req.ctx.requestId });
      return;
    }

    const appId = String(req.body.appId || '').trim();
    if (!appId) {
      res.status(400).json({ error: 'appId is required', requestId: req.ctx.requestId });
      return;
    }

    const updated = await this.customerBase44Service.linkExistingApp(
      customer,
      {
        tenantId: req.ctx.tenantId,
        customerId: customer.id,
        actorId: req.ctx.actorId,
        appId,
        appName: String(req.body.appName || customer.companyName || '').trim() || undefined,
        editorUrl: String(req.body.editorUrl || '').trim() || undefined,
        previewUrl: String(req.body.previewUrl || '').trim() || undefined,
        templateKey: String(req.body.templateKey || customer.templateKey || '').trim() || undefined,
        niche: String(req.body.niche || customer.niche || '').trim() || undefined,
        requestedPrompt:
          String(req.body.requestedPrompt || '').trim() ||
          customer.requestedPrompt ||
          buildBase44Prompt({
            companyName: customer.companyName,
            domain: customer.domain,
            packageCode: customer.packageCode,
            niche: req.body.niche || customer.niche,
            templateKey: req.body.templateKey || customer.templateKey,
            city: customer.city,
            extras: customer.extras,
          }),
      },
    );

    res.status(200).json({ data: updated, requestId: req.ctx.requestId });
  };

  syncCustomerContent = async (req: Request, res: Response): Promise<void> => {
    const customerId = getSingleParam(req.params.customerId, 'customerId');
    const customer = await this.customersService.getCustomerById(req.ctx.tenantId, customerId);

    if (!customer) {
      res.status(404).json({ error: 'Customer not found', requestId: req.ctx.requestId });
      return;
    }

    ensureHasBase44Linked(customer);

    const indexHtml = String(req.body.indexHtml || '').trim();
    if (!indexHtml) {
      res.status(400).json({ error: 'indexHtml is required', requestId: req.ctx.requestId });
      return;
    }

    const syncResult = await this.contentSyncService.syncCustomerContent(customer, {
      customerId: customer.id,
      tenantId: req.ctx.tenantId,
      actorId: req.ctx.actorId,
      projectId: String(req.body.projectId || customer.base44?.appId || '').trim() || undefined,
      indexHtml,
      additionalFiles: parseAdditionalFiles(req.body.additionalFiles),
    });

    const refreshed = await this.customersService.getCustomerById(
      req.ctx.tenantId,
      customer.id,
    );

    res.status(200).json({
      data: {
        customer: refreshed,
        sync: syncResult,
      },
      requestId: req.ctx.requestId,
    });
  };

  markPreviewReady = async (req: Request, res: Response): Promise<void> => {
    const customerId = getSingleParam(req.params.customerId, 'customerId');
    const customer = await this.customersService.getCustomerById(req.ctx.tenantId, customerId);

    if (!customer) {
      res.status(404).json({ error: 'Customer not found', requestId: req.ctx.requestId });
      return;
    }

    ensureHasBase44Linked(customer);

    const previewUrl =
      String(req.body.previewUrl || '').trim() ||
      String(customer.base44?.previewUrl || '').trim();

    if (!previewUrl) {
      throw new ConflictHttpError('Preview URL ontbreekt. Vul eerst de Base44 preview URL in.');
    }

    const updated = await this.customersService.updateWorkflowState(
      customer,
      {
        tenantId: req.ctx.tenantId,
        actorId: req.ctx.actorId,
        customerId: customer.id,
        status: 'awaiting_approval',
        websiteBuildStatus: 'PREVIEW_READY',
        previewUrl,
      },
    );

    res.status(200).json({ data: updated, requestId: req.ctx.requestId });
  };

  markApprovedForProduction = async (req: Request, res: Response): Promise<void> => {
    const customerId = getSingleParam(req.params.customerId, 'customerId');
    const customer = await this.customersService.getCustomerById(req.ctx.tenantId, customerId);

    if (!customer) {
      res.status(404).json({ error: 'Customer not found', requestId: req.ctx.requestId });
      return;
    }

    ensureHasPreview(customer);
    ensurePreviewReady(customer);

    const updated = await this.customersService.updateWorkflowState(
      customer,
      {
        tenantId: req.ctx.tenantId,
        actorId: req.ctx.actorId,
        customerId: customer.id,
        status: 'approved',
        websiteBuildStatus: 'APPROVED_FOR_PRODUCTION',
        previewUrl: String(req.body.previewUrl || customer.base44?.previewUrl || '').trim(),
      },
    );

    res.status(200).json({ data: updated, requestId: req.ctx.requestId });
  };

  deployCustomer = async (req: Request, res: Response): Promise<void> => {
    const customerId = getSingleParam(req.params.customerId, 'customerId');
    const customer = await this.customersService.getCustomerById(req.ctx.tenantId, customerId);

    if (!customer) {
      res.status(404).json({ error: 'Customer not found', requestId: req.ctx.requestId });
      return;
    }

    ensureApprovedForProduction(customer);
    ensureContentSynced(customer);

    if (req.body.provisionMail !== false) {
      await this.mailProvisioningService.provisionPackageMail({
        customerId: customer.id,
        domain: customer.domain,
        packageCode: toPackageCode(customer.packageCode),
        selectedMailboxes: customer.selectedMailboxLocalParts,
      });
    }

    const input = normalizeCreateDeploymentInput({
      customerId: customer.id,
      tenantId: req.ctx.tenantId,
      projectName: req.body.projectName || customer.companyName,
      domain: customer.domain,
      packageCode: customer.packageCode,
      addOns: customer.extras,
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
        const updatedCustomer = await this.customersService.updateWorkflowState(
          customer,
          {
            tenantId: req.ctx.tenantId,
            actorId: req.ctx.actorId,
            customerId: customer.id,
            status: 'provisioning',
            websiteBuildStatus: 'APPROVED_FOR_PRODUCTION',
            deploymentId: existingOperation.deploymentId,
            deploymentStatus: existingOperation.status,
            liveDomain: customer.domain,
          },
        );

        res.status(200).json({
          data: {
            reused: true,
            customer: updatedCustomer,
            operationId: existingOperation.operationId,
            deploymentId: existingOperation.deploymentId,
            status: existingOperation.status,
            liveDomain: customer.domain,
            mailProvisioned: req.body.provisionMail !== false,
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

    const updatedCustomer = await this.customersService.updateWorkflowState(
      customer,
      {
        tenantId: req.ctx.tenantId,
        actorId: req.ctx.actorId,
        customerId: customer.id,
        status: 'provisioning',
        websiteBuildStatus: 'APPROVED_FOR_PRODUCTION',
        deploymentId,
        deploymentStatus: deployment.status,
        deploymentStage: deployment.currentStage ?? null,
        liveDomain: customer.domain,
      },
    );

    const { AuditService } = await import('../../../domain/audit/audit.service');
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
        source: 'CUSTOMER_WORKFLOW',
      },
    });

    void import('../../../domain/deployments/deployment-orchestrator.service').then(
      async ({ DeploymentOrchestratorService }) => {
        const orchestrator = new DeploymentOrchestratorService();
        await orchestrator.runCreate(deploymentId, operation.operationId);
      },
    );

    res.status(202).json({
      data: {
        customerId: customer.id,
        customer: updatedCustomer,
        deploymentId,
        operationId: operation.operationId,
        status: deployment.status,
        currentStage: deployment.currentStage ?? null,
        liveDomain: customer.domain,
        mailProvisioned: req.body.provisionMail !== false,
      },
      requestId: req.ctx.requestId,
    });
  };
}
