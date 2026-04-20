import crypto from 'node:crypto';
import { CustomersRepository } from '../repositories/customers.repository';
import { PreviewService } from '../../preview/services/preview.service';
import type {
  CreateCustomerInput,
  CustomerRecord,
} from '../types/customer.types';

function slugify(value: string): string {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export class CustomersService {
  constructor(
    private readonly customersRepository = new CustomersRepository(),
    private readonly previewService = new PreviewService(),
  ) {}

  async createCustomer(input: CreateCustomerInput): Promise<CustomerRecord> {
    const now = new Date().toISOString();

    const domain = input.domain.trim().toLowerCase();
    const companySlug = slugify(input.companyName);
    const domainSlug = slugify(domain.split('.')[0] || input.companyName);

    const preview = this.previewService.buildPreviewMetadata({
      companyName: input.companyName,
      domain,
    });

    const customer: CustomerRecord = {
      id: `cust_${companySlug || domainSlug || crypto.randomUUID()}`,
      tenantId: input.tenantId,
      companyName: input.companyName.trim(),
      contactName: input.contactName.trim(),
      email: input.email.trim().toLowerCase(),
      phone: input.phone?.trim(),
      domain,
      packageCode: input.packageCode.trim().toUpperCase(),
      extras: Array.isArray(input.extras) ? input.extras : [],
      notes: input.notes?.trim(),
      address: input.address?.trim(),
      postalCode: input.postalCode?.trim(),
      city: input.city?.trim(),
      country: input.country?.trim() || 'Nederland',

      status: 'onboarding',
      websiteBuildStatus: 'APP_REQUESTED',

      finance: {
        monthlyRevenueInclVat: Number(input.monthlyRevenueInclVat || 0),
        monthlyInfraCostInclVat: Number(input.monthlyInfraCostInclVat || 0),
        oneTimeSetupInclVat: Number(input.oneTimeSetupInclVat || 0),
        vatRate: Number(input.vatRate || 0.21),
        currency: 'EUR',
      },

      base44: {
        status: 'NOT_CREATED',
      },

      preview,

      deployment: {},

      createdAt: now,
      updatedAt: now,
      createdBy: input.createdBy,
      updatedBy: input.createdBy,
    };

    await this.customersRepository.create(customer);
    return customer;
  }

  async updateWorkflowState(
    customer: CustomerRecord,
    params: {
      tenantId: string;
      actorId: string;
      customerId: string;
      status: CustomerRecord['status'];
      websiteBuildStatus: CustomerRecord['websiteBuildStatus'];
      previewUrl?: string;
      deploymentId?: string;
      deploymentStatus?: string;
      deploymentStage?: string | null;
      liveDomain?: string;
    },
  ): Promise<CustomerRecord> {
    const now = new Date().toISOString();

    const previewMeta = this.previewService.buildPreviewMetadata({
      companyName: customer.companyName,
      domain: customer.domain,
      base44PreviewUrl: params.previewUrl || customer.base44?.previewUrl,
    });

    const updated: CustomerRecord = {
      ...customer,
      status: params.status,
      websiteBuildStatus: params.websiteBuildStatus,
      updatedAt: now,
      updatedBy: params.actorId,

      base44: {
        ...customer.base44,
        previewUrl: params.previewUrl || customer.base44?.previewUrl,
      },

      preview: {
        ...customer.preview,
        ...previewMeta,
      },

      deployment: {
        ...customer.deployment,
        deploymentId: params.deploymentId ?? customer.deployment?.deploymentId,
        status: params.deploymentStatus ?? customer.deployment?.status,
        currentStage:
          params.deploymentStage ?? customer.deployment?.currentStage,
        liveDomain: params.liveDomain ?? customer.deployment?.liveDomain,
      },
    };

    if (params.websiteBuildStatus === 'LIVE') {
      updated.preview = {
        ...updated.preview,
        status: 'ARCHIVED',
        updatedAt: now,
      };
    }

    await this.customersRepository.update(updated);
    return updated;
  }

  async getCustomerById(
    tenantId: string,
    customerId: string,
  ): Promise<CustomerRecord | null> {
    const customer = await this.customersRepository.getById(customerId);

    if (!customer) return null;
    if (customer.tenantId !== tenantId) return null;

    return customer;
  }

  async listCustomers(tenantId: string): Promise<CustomerRecord[]> {
    return this.customersRepository.listByTenant(tenantId);
  }
}