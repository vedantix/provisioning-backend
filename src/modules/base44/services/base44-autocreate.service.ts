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

export interface Base44CreateAppResult {
  appId: string;
  appName: string;
  editorUrl?: string;
  previewUrl?: string;
}

export class Base44AutoCreateService {
  private provider = new Base44Provider();

  async createApp(input: Base44CreateAppInput): Promise<Base44CreateAppResult> {
    try {
      const result = await this.provider.createApp({
        name: input.companyName,
        prompt: input.prompt,
        templateKey: input.templateKey,
        niche: input.niche,
      });

      if (!result?.appId) {
        throw new Error('Base44 did not return an appId');
      }

      return {
        appId: result.appId,
        appName: result.appName ?? input.companyName,
        editorUrl: result.editorUrl,
        previewUrl: result.previewUrl,
      };
    } catch (error: any) {
      let message: string = 'Base44 auto-create failed';

      if (error?.response) {
        const response = error.response;
        let parsed: any = null;

        try {
          parsed = response.data;
        } catch {
          parsed = null;
        }

        message = `Base44 auto-create failed with status ${response.status}`;

        if (parsed && typeof parsed === 'object') {
          const maybeError = parsed.error;
          const maybeMessage = parsed.message;

          if (typeof maybeError === 'string' && maybeError.trim()) {
            message = maybeError;
          } else if (typeof maybeMessage === 'string' && maybeMessage.trim()) {
            message = maybeMessage;
          }
        }
      } else if (error instanceof Error) {
        message = error.message;
      }

      throw new Error(message);
    }
  }
}