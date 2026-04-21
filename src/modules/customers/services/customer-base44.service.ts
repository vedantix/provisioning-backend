import { CustomersRepository } from '../repositories/customers.repository';
import { DeploymentTriggerService } from '../../deployment/services/deployment-trigger.service';
import type {
  CustomerRecord,
  LinkBase44AppInput,
} from '../types/customer.types';

export class CustomerBase44Service {
  private repo = new CustomersRepository();
  private deployService = new DeploymentTriggerService();

  async linkExistingApp(
    customer: CustomerRecord,
    input: LinkBase44AppInput,
  ): Promise<CustomerRecord> {
    const now = new Date().toISOString();

    await this.repo.updateBase44Link({
      customerId: input.customerId,
      tenantId: input.tenantId,
      updatedAt: now,
      updatedBy: input.actorId,

      status: 'building',
      websiteBuildStatus: 'IN_PROGRESS',
      base44Status: 'READY',

      appId: input.appId,
      appName: input.appName,
      editorUrl: input.editorUrl,
      previewUrl: input.previewUrl,

      templateKey: input.templateKey,
      niche: input.niche,
      requestedPrompt: input.requestedPrompt,

      linkedAt: now,
    });

    await this.deployService.triggerWebsiteBuild({
      bucket: `vedantix-${customer.domain.replace(/\./g, '-')}`,
      distributionId: customer.deployment?.distributionId ?? '',
    });

    const updatedCustomer = await this.repo.getById(input.customerId);

    if (!updatedCustomer) {
      throw new Error('Customer not found after Base44 link update');
    }

    return updatedCustomer;
  }
}