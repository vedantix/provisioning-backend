import { CustomersService } from '../../customers/services/customers.service';
import { ContentSyncService } from '../../content-sync/services/content-sync.service';
import type { CustomerRecord } from '../../customers/types/customer.types';

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
    let previewReady =
      workingCustomer.websiteBuildStatus === 'PREVIEW_READY' ||
      workingCustomer.websiteBuildStatus === 'APPROVED_FOR_PRODUCTION' ||
      workingCustomer.websiteBuildStatus === 'LIVE';

    if (!workingCustomer.base44?.appId) {
      throw new Error(
        'Base44 app is nog niet gekoppeld. Gebruik eerst de link-flow na het aanmaken in Base44.',
      );
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