import axios from 'axios';

export interface Base44CreateAppPayload {
  name: string;
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

export class Base44Provider {
  private readonly apiKey = process.env.BASE44_API_KEY!;
  private readonly baseUrl =
    (process.env.BASE44_API_URL ?? '').replace(/\/$/, '');

  async createApp(
    payload: Base44CreateAppPayload,
  ): Promise<Base44CreateAppResult> {
    const url = `${this.baseUrl}/apps`;

    try {
      const response = await axios.post(url, payload, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      });

      const data = response.data;

      return {
        appId: data.id ?? data.appId,
        appName: data.name ?? data.appName ?? payload.name,
        editorUrl: data.editorUrl,
        previewUrl: data.previewUrl,
      };
    } catch (error: any) {
      console.error('[BASE44_PROVIDER_ERROR]', {
        url,
        status: error?.response?.status,
        data: error?.response?.data,
        message: error?.message,
      });

      throw error;
    }
  }
}