import { CustomersRepository } from '../repositories/customers.repository';
import { DeploymentTriggerService } from '../../deployment/services/deployment-trigger.service';

export class CustomerBase44Service {
  private repo = new CustomersRepository();
  private deployService = new DeploymentTriggerService();

  async linkExistingApp(
    customer: any,
    input: {
      tenantId: string;
      customerId: string;
      actorId: string;

      appId: string;
      appName: string;
      editorUrl?: string;
      previewUrl?: string;

      templateKey?: string;
      niche?: string;
      requestedPrompt?: string;
    },
  ) {
    const now = new Date().toISOString();

    await this.repo.updateBase44Link({
      customerId: input.customerId,
      tenantId: input.tenantId,
      updatedAt: now,
      updatedBy: input.actorId,

      status: 'IN_PROGRESS',
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

    // 🔥 automatische deployment trigger
    await this.deployService.triggerWebsiteBuild({
      bucket: `vedantix-${customer.domain.replace(/\./g, '-')}`,
      distributionId: customer.deployment?.distributionId ?? '',
    });

    return this.repo.getById(input.customerId);
  }
}