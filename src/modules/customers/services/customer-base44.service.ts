import { CustomersRepository } from '../repositories/customers.repository';
import { PreviewService } from '../../preview/services/preview.service';
import type {
  CustomerRecord,
  LinkBase44AppInput,
} from '../types/customer.types';

export class CustomerBase44Service {
  private repo = new CustomersRepository();
  private previewService = new PreviewService();

  async requestAppCreation(
    customer: CustomerRecord,
    input: {
      tenantId: string;
      customerId: string;
      actorId: string;
      templateKey?: string;
      niche?: string;
      requestedPrompt: string;
    },
  ): Promise<CustomerRecord> {
    const now = new Date().toISOString();

    const updatedCustomer: CustomerRecord = {
      ...customer,
      status: 'building',
      websiteBuildStatus: 'APP_REQUESTED',
      updatedAt: now,
      updatedBy: input.actorId,
      templateKey: input.templateKey ?? customer.templateKey,
      niche: input.niche ?? customer.niche,
      requestedPrompt: input.requestedPrompt,
      base44: {
        ...customer.base44,
        status: 'CREATING',
        templateKey: input.templateKey ?? customer.base44?.templateKey,
        niche: input.niche ?? customer.base44?.niche,
        requestedPrompt: input.requestedPrompt,
      },
    };

    await this.repo.update(updatedCustomer);

    const refreshed = await this.repo.getById(input.customerId);
    if (!refreshed) {
      throw new Error('Customer not found after Base44 build request update');
    }

    return refreshed;
  }

  async linkExistingApp(
    customer: CustomerRecord,
    input: LinkBase44AppInput,
  ): Promise<CustomerRecord> {
    const now = new Date().toISOString();
    const previewUrl = this.previewService.resolvePreviewTargetUrl({
      base44PreviewUrl: input.previewUrl,
      base44EditorUrl: input.editorUrl,
      base44AppName: input.appName,
      fallbackTargetUrl: customer.preview?.targetUrl,
    });

    await this.repo.updateBase44Link({
      customerId: input.customerId,
      tenantId: input.tenantId,
      updatedAt: now,
      updatedBy: input.actorId,

      status: 'building',
      websiteBuildStatus: 'APP_LINKED',
      base44Status: 'LINKED',

      appId: input.appId,
      appName: input.appName,
      editorUrl: input.editorUrl,
      previewUrl: previewUrl || input.previewUrl,

      templateKey: input.templateKey,
      niche: input.niche,
      requestedPrompt: input.requestedPrompt,

      linkedAt: now,
    });

    const updatedCustomer = await this.repo.getById(input.customerId);

    if (!updatedCustomer) {
      throw new Error('Customer not found after Base44 link update');
    }

    const preview = this.previewService.buildPreviewMetadata({
      companyName: updatedCustomer.companyName,
      domain: updatedCustomer.domain,
      base44PreviewUrl: previewUrl || input.previewUrl || updatedCustomer.base44?.previewUrl,
      base44EditorUrl: input.editorUrl || updatedCustomer.base44?.editorUrl,
      base44AppName: input.appName || updatedCustomer.base44?.appName,
      fallbackTargetUrl: updatedCustomer.preview?.targetUrl,
    });

    const customerWithPreview: CustomerRecord = {
      ...updatedCustomer,
      preview: {
        ...updatedCustomer.preview,
        ...preview,
      },
    };

    await this.repo.update(customerWithPreview);

    return customerWithPreview;
  }
}
