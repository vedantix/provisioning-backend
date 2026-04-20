import { CustomersService } from '../../customers/services/customers.service';
import { CustomerBase44Service } from '../../customers/services/customer-base44.service';
import { Base44AutoCreateService } from '../../base44/services/base44-autocreate.service';
import { ContentSyncService } from '../../content-sync/services/content-sync.service';
import type { CustomerRecord } from '../../customers/types/customer.types';

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

export type StartCustomerBuildFlowInput = {
  tenantId: string;
  actorId: string;
  customerId: string;
  niche?: string;
  templateKey?: string;
  requestedPrompt?: string;
  projectId?: string;
  indexHtml?: string;
  additionalFiles?: Array<{
    path: string;
    content: string;
    encoding?: 'utf-8' | 'base64';
  }>;
};

export type StartCustomerBuildFlowResult = {
  customer: CustomerRecord;
  steps: {
    base44Linked: boolean;
    contentSynced: boolean;
    previewReady: boolean;
  };
};

export class CustomerBuildFlowService {
  constructor(
    private readonly customersService = new CustomersService(),
    private readonly customerBase44Service = new CustomerBase44Service(),
    private readonly base44AutoCreateService = new Base44AutoCreateService(),
    private readonly contentSyncService = new ContentSyncService(),
  ) {}

  async startFlow(
    customer: CustomerRecord,
    input: StartCustomerBuildFlowInput,
  ): Promise<StartCustomerBuildFlowResult> {
    let workingCustomer = customer;
    let base44Linked = Boolean(workingCustomer.base44?.appId);
    let contentSynced = Boolean(
      workingCustomer.contentSync?.status === 'SYNCED' &&
        workingCustomer.contentSync?.repositoryName,
    );
    let previewReady = workingCustomer.websiteBuildStatus === 'PREVIEW_READY';

    const prompt =
      input.requestedPrompt ||
      buildBase44Prompt({
        companyName: workingCustomer.companyName,
        domain: workingCustomer.domain,
        packageCode: workingCustomer.packageCode,
        niche: input.niche,
        templateKey: input.templateKey,
        city: workingCustomer.city,
        extras: workingCustomer.extras,
      });

    if (!workingCustomer.base44?.appId) {
      const createdApp = await this.base44AutoCreateService.createApp({
        customerId: workingCustomer.id,
        companyName: workingCustomer.companyName,
        domain: workingCustomer.domain,
        packageCode: workingCustomer.packageCode,
        niche: input.niche,
        templateKey: input.templateKey,
        prompt,
      });

      workingCustomer = await this.customerBase44Service.linkExistingApp(
        workingCustomer,
        {
          tenantId: input.tenantId,
          actorId: input.actorId,
          customerId: workingCustomer.id,
          appId: createdApp.appId,
          appName: createdApp.appName,
          editorUrl: createdApp.editorUrl,
          previewUrl: createdApp.previewUrl,
          templateKey: input.templateKey,
          niche: input.niche,
          requestedPrompt: prompt,
        },
      );

      base44Linked = true;
    }

    if (input.indexHtml?.trim()) {
      await this.contentSyncService.syncCustomerContent(workingCustomer, {
        customerId: workingCustomer.id,
        tenantId: input.tenantId,
        actorId: input.actorId,
        projectId: input.projectId || workingCustomer.base44?.appId,
        indexHtml: input.indexHtml,
        additionalFiles: Array.isArray(input.additionalFiles)
          ? input.additionalFiles
          : [],
      });

      const refreshedAfterSync = await this.customersService.getCustomerById(
        input.tenantId,
        workingCustomer.id,
      );

      if (!refreshedAfterSync) {
        throw new Error('Customer not found after content sync');
      }

      workingCustomer = refreshedAfterSync;
      contentSynced = true;
    }

    if (
      workingCustomer.base44?.previewUrl &&
      workingCustomer.websiteBuildStatus !== 'PREVIEW_READY' &&
      workingCustomer.websiteBuildStatus !== 'APPROVED_FOR_PRODUCTION' &&
      workingCustomer.websiteBuildStatus !== 'LIVE'
    ) {
      workingCustomer = await this.customersService.updateWorkflowState(
        workingCustomer,
        {
          tenantId: input.tenantId,
          actorId: input.actorId,
          customerId: workingCustomer.id,
          status: 'awaiting_approval',
          websiteBuildStatus: 'PREVIEW_READY',
          previewUrl: workingCustomer.base44.previewUrl,
        },
      );

      previewReady = true;
    } else if (workingCustomer.base44?.previewUrl) {
      previewReady = true;
    }

    return {
      customer: workingCustomer,
      steps: {
        base44Linked,
        contentSynced,
        previewReady,
      },
    };
  }
}