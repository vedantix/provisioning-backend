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

  autoCreateBase44App = async (_req: Request, res: Response): Promise<void> => { res.status(501).json({ error: 'Not implemented' }); };
  linkBase44App = async (_req: Request, res: Response): Promise<void> => { res.status(501).json({ error: 'Not implemented' }); };
  syncCustomerContent = async (_req: Request, res: Response): Promise<void> => { res.status(501).json({ error: 'Not implemented' }); };
  markPreviewReady = async (_req: Request, res: Response): Promise<void> => { res.status(501).json({ error: 'Not implemented' }); };
  markApprovedForProduction = async (_req: Request, res: Response): Promise<void> => { res.status(501).json({ error: 'Not implemented' }); };

  deployCustomer = async (req: Request, res: Response): Promise<void> => {
    const customerId = getSingleParam(req.params.customerId, 'customerId');
    const customer = await this.customersService.getCustomerById(req.ctx.tenantId, customerId);

    if (!customer) {
      res.status(404).json({ error: 'Customer not found', requestId: req.ctx.requestId });
      return;
    }

    if (req.body.provisionMail !== false) {
      await this.mailProvisioningService.provisionPackageMail({
        customerId: customer.id,
        domain: customer.domain,
        packageCode: toPackageCode(customer.packageCode),
        selectedMailboxes: customer.selectedMailboxLocalParts,
      });
    }

    res.status(202).json({
      data: {
        customerId: customer.id,
        mailProvisioned: req.body.provisionMail !== false,
      },
      requestId: req.ctx.requestId,
    });
  };
}
