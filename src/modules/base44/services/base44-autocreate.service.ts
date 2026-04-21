import { Base44Provider } from '../providers/base44.providers';

export interface Base44CreateAppInput {
  customerId: string;
  companyName: string;
  domain: string;
  packageCode: string;
  prompt: string;
  templateKey?: string;
  niche?: string;
}

export class Base44AutoCreateService {
  private provider = new Base44Provider();

  async createApp(input: Base44CreateAppInput) {
    const appName = `${input.companyName}`;

    const result = await this.provider.createApp({
      name: appName,
      prompt: input.prompt,
      templateKey: input.templateKey,
      niche: input.niche,
    });

    return result;
  }
}