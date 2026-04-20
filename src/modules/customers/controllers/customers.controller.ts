import type { Request, Response } from 'express';
import { CustomersService } from '../services/customers.service';
import { CustomerBase44Service } from '../services/customer-base44.service';
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
import { Base44AutoCreateService } from '../../base44/services/base44-autocreate.service';

function getSingleParam(
  value: string | string[] | undefined,
  name: string,
): string {
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
    normalized === 'PRO'
  ) {
    return normalized;
  }

  throw new Error(`Unsupported package code for mail provisioning: ${value}`);
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
    throw new ConflictHttpError(
      'Base44 app is nog niet gekoppeld voor deze klant.',
    );
  }
}

function ensureHasPreview(customer: any): void {
  if (!customer?.base44?.previewUrl) {
    throw new ConflictHttpError(
      'Preview URL ontbreekt. Zet eerst een preview klaar.',
    );
  }
}

function ensurePreviewReady(customer: any): void {
  if (
    customer?.websiteBuildStatus !== 'PREVIEW_READY' &&
    customer?.websiteBuildStatus !== 'APPROVED_FOR_PRODUCTION' &&
    customer?.websiteBuildStatus !== 'LIVE'
  ) {
    throw new ConflictHttpError(
      'Preview is nog niet klaar voor review.',
    );
  }
}

function ensureApprovedForProduction(customer: any): void {
  if (
    customer?.websiteBuildStatus !== 'APPROVED_FOR_PRODUCTION' &&
    customer?.websiteBuildStatus !== 'LIVE'
  ) {
    throw new ConflictHttpError(
      'Klant is nog niet goedgekeurd voor productie.',
    );
  }
}

export class CustomersController {
  constructor(
    private readonly customersService = new CustomersService(),
    private readonly customerBase44Service = new CustomerBase44Service(),
    private readonly idempotencyService = new IdempotencyService(),
    private readonly deploymentsRepository = new DeploymentsRepository(),
    private readonly operationsRepository = new OperationsRepository(),
    private readonly mailProvisioningService = new MailProvisioningService(),
    private readonly financeService = new FinanceService(),
    private readonly base44AutoCreateService = new Base44AutoCreateService(),
  ) {}

  createCustomer = async (req: Request, res: Response): Promise<void> => {
    const customer = await this.customersService.createCustomer({
      tenantId: req.ctx.tenantId,
      createdBy: req.ctx.actorId,
      companyName: req.body.companyName,
      contactName: req.body.contactName,
      email: req.body.email,
      phone: req.body.phone,
      domain: req.body.domain,
      packageCode: req.body.packageCode,
      extras: req.body.extras,
      notes: req.body.notes,
      address: req.body.address,
      postalCode: req.body.postalCode,
      city: req.body.city,
      country: req.body.country,
      monthlyRevenueInclVat: req.body.monthlyRevenueInclVat,
      monthlyInfraCostInclVat: req.body.monthlyInfraCostInclVat,
      oneTimeSetupInclVat: req.body.oneTimeSetupInclVat,
      vatRate: req.body.vatRate,
    });

    res.status(201).json({
      data: customer,
      requestId: req.ctx.requestId,
    });
  };

  listCustomers = async (req: Request, res: Response): Promise<void> => {
    const customers = await this.customersService.listCustomers(req.ctx.tenantId);

    res.status(200).json({
      data: customers,
      requestId: req.ctx.requestId,
    });
  };

  getCustomer = async (req: Request, res: Response): Promise<void> => {
    const customerId = getSingleParam(req.params.customerId, 'customerId');

    const customer = await this.customersService.getCustomerById(
      req.ctx.tenantId,
      customerId,
    );

    if (!customer) {
      res.status(404).json({
        error: 'Customer not found',
        requestId: req.ctx.requestId,
      });
      return;
    }

    res.status(200).json({
      data: customer,
      requestId: req.ctx.requestId,
    });
  };

  autoCreateBase44App = async (req: Request, res: Response): Promise<void> => {
    const customerId = getSingleParam(req.params.customerId, 'customerId');

    const customer = await this.customersService.getCustomerById(
      req.ctx.tenantId,
      customerId,
    );

    if (!customer) {
      res.status(404).json({
        error: 'Customer not found',
        requestId: req.ctx.requestId,
      });
      return;
    }

    const prompt =
      req.body.requestedPrompt ||
      buildBase44Prompt({
        companyName: customer.companyName,
        domain: customer.domain,
        packageCode: customer.packageCode,
        niche: req.body.niche,
        templateKey: req.body.templateKey,
        city: customer.city,
        extras: customer.extras,
      });

    const createdApp = await this.base44AutoCreateService.createApp({
      customerId: customer.id,
      companyName: customer.companyName,
      domain: customer.domain,
      packageCode: customer.packageCode,
      niche: req.body.niche,
      templateKey: req.body.templateKey,
      prompt,
    });

    const updated = await this.customerBase44Service.linkExistingApp(customer, {
      tenantId: req.ctx.tenantId,
      actorId: req.ctx.actorId,
      customerId,
      appId: createdApp.appId,
      appName: createdApp.appName,
      editorUrl: createdApp.editorUrl,
      previewUrl: createdApp.previewUrl,
      templateKey: req.body.templateKey,
      niche: req.body.niche,
      requestedPrompt: prompt,
    });

    res.status(200).json({
      data: updated,
      requestId: req.ctx.requestId,
    });
  };

  linkBase44App = async (req: Request, res: Response): Promise<void> => {
    const customerId = getSingleParam(req.params.customerId, 'customerId');

    const customer = await this.customersService.getCustomerById(
      req.ctx.tenantId,
      customerId,
    );

    if (!customer) {
      res.status(404).json({
        error: 'Customer not found',
        requestId: req.ctx.requestId,
      });
      return;
    }

    const updated = await this.customerBase44Service.linkExistingApp(customer, {
      tenantId: req.ctx.tenantId,
      actorId: req.ctx.actorId,
      customerId,
      appId: req.body.appId,
      appName: req.body.appName,
      editorUrl: req.body.editorUrl,
      previewUrl: req.body.previewUrl,
      templateKey: req.body.templateKey,
      niche: req.body.niche,
      requestedPrompt: req.body.requestedPrompt,
    });

    res.status(200).json({
      data: updated,
      requestId: req.ctx.requestId,
    });
  };

  markPreviewReady = async (req: Request, res: Response): Promise<void> => {
    const customerId = getSingleParam(req.params.customerId, 'customerId');

    const customer = await this.customersService.getCustomerById(
      req.ctx.tenantId,
      customerId,
    );

    if (!customer) {
      res.status(404).json({
        error: 'Customer not found',
        requestId: req.ctx.requestId,
      });
      return;
    }

    ensureHasBase44Linked(customer);

    const previewUrl = req.body.previewUrl || customer.base44?.previewUrl;
    if (!previewUrl) {
      throw new ConflictHttpError(
        'Preview URL ontbreekt. Vul eerst een preview URL in of laat die uit Base44 terugkomen.',
      );
    }

    const updated = await this.customersService.updateWorkflowState(customer, {
      tenantId: req.ctx.tenantId,
      actorId: req.ctx.actorId,
      customerId,
      status: 'awaiting_approval',
      websiteBuildStatus: 'PREVIEW_READY',
      previewUrl,
    });

    res.status(200).json({
      data: updated,
      requestId: req.ctx.requestId,
    });
  };

  markApprovedForProduction = async (req: Request, res: Response): Promise<void> => {
    const customerId = getSingleParam(req.params.customerId, 'customerId');

    const customer = await this.customersService.getCustomerById(
      req.ctx.tenantId,
      customerId,
    );

    if (!customer) {
      res.status(404).json({
        error: 'Customer not found',
        requestId: req.ctx.requestId,
      });
      return;
    }

    ensureHasBase44Linked(customer);
    ensureHasPreview(customer);
    ensurePreviewReady(customer);

    const updated = await this.customersService.updateWorkflowState(customer, {
      tenantId: req.ctx.tenantId,
      actorId: req.ctx.actorId,
      customerId,
      status: 'approved',
      websiteBuildStatus: 'APPROVED_FOR_PRODUCTION',
      previewUrl: req.body.previewUrl || customer.base44?.previewUrl,
    });

    res.status(200).json({
      data: updated,
      requestId: req.ctx.requestId,
    });
  };

  deployCustomer = async (req: Request, res: Response): Promise<void> => {
    const customerId = getSingleParam(req.params.customerId, 'customerId');

    const customer = await this.customersService.getCustomerById(
      req.ctx.tenantId,
      customerId,
    );

    if (!customer) {
      res.status(404).json({
        error: 'Customer not found',
        requestId: req.ctx.requestId,
      });
      return;
    }

    ensureHasBase44Linked(customer);
    ensureHasPreview(customer);
    ensureApprovedForProduction(customer);

    const input = normalizeCreateDeploymentInput({
      customerId: customer.id,
      tenantId: req.ctx.tenantId,
      projectName:
        req.body.projectName ||
        customer.companyName?.toLowerCase().replace(/[^a-z0-9]+/g, '-') ||
        customer.domain.split('.')[0],
      domain: customer.domain,
      packageCode: customer.packageCode,
      addOns: customer.extras || [],
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

    const crypto = await import('node:crypto');
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

    const updatedCustomer = await this.customersService.updateWorkflowState(customer, {
      tenantId: req.ctx.tenantId,
      actorId: req.ctx.actorId,
      customerId: customer.id,
      status: 'provisioning',
      websiteBuildStatus: 'APPROVED_FOR_PRODUCTION',
      previewUrl: customer.base44?.previewUrl,
      deploymentId,
      deploymentStatus: deployment.status,
      deploymentStage: deployment.currentStage ?? null,
      liveDomain: customer.domain,
    });

    if (req.body.provisionMail !== false) {
      await this.mailProvisioningService.provisionPackageMail({
        customerId: customer.id,
        domain: customer.domain,
        packageCode: toPackageCode(customer.packageCode),
      });
    }

    if (req.body.bootstrapFinance !== false) {
      await this.financeService.bootstrapCustomerFinance({
        tenantId: req.ctx.tenantId,
        customerId: customer.id,
        companyName: customer.companyName,
        packageCode: customer.packageCode,
        extras: customer.extras || [],
        monthlyInfraCost: Number(customer.finance?.monthlyInfraCostInclVat || 0),
        oneTimeSetupCost: Number(customer.finance?.oneTimeSetupInclVat || 0),
        isActive: true,
      });
    }

    void import('../../../domain/deployments/deployment-orchestrator.service').then(
      async ({ DeploymentOrchestratorService }) => {
        const orchestrator = new DeploymentOrchestratorService();
        await orchestrator.runCreate(deploymentId, operation.operationId);
      },
    );

    res.status(202).json({
      data: {
        customer: updatedCustomer,
        deploymentId,
        operationId: operation.operationId,
        status: deployment.status,
        currentStage: deployment.currentStage ?? null,
      },
      requestId: req.ctx.requestId,
    });
  };
}