import { env } from '../../../config/env';
import { CustomersRepository } from '../repositories/customers.repository';
import type { CustomerRecord, LinkBase44AppInput } from '../types/customer.types';

function slugify(value: string): string {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export class CustomerBase44Service {
  constructor(
    private readonly customersRepository = new CustomersRepository(),
  ) {}

  async linkExistingApp(
    customer: CustomerRecord,
    input: LinkBase44AppInput,
  ): Promise<CustomerRecord> {
    const now = new Date().toISOString();
    const previewSlug = slugify(customer.companyName) || slugify(customer.domain);

    const editorUrl =
      input.editorUrl?.trim() ||
      `${env.base44EditorBaseUrl.replace(/\/$/, '')}/${input.appId}`;

    const previewUrl =
      input.previewUrl?.trim() ||
      `${env.base44PreviewBaseUrl.replace(/\/$/, '')}/${previewSlug}`;

    await this.customersRepository.updateBase44Link({
      customerId: customer.id,
      updatedAt: now,
      updatedBy: input.actorId,
      status: 'building',
      websiteBuildStatus: 'APP_LINKED',
      base44Status: 'LINKED',
      appId: input.appId.trim(),
      appName: input.appName?.trim() || customer.companyName,
      editorUrl,
      previewUrl,
      templateKey: input.templateKey?.trim(),
      niche: input.niche?.trim(),
      requestedPrompt: input.requestedPrompt?.trim(),
      linkedAt: now,
    });

    const updated = await this.customersRepository.getById(customer.id);
    if (!updated) {
      throw new Error('Customer not found after Base44 link update');
    }

    return updated;
  }
}