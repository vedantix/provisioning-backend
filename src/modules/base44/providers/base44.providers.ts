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
    process.env.BASE44_API_URL ?? 'https://api.base44.com';

  async createApp(
    payload: Base44CreateAppPayload,
  ): Promise<Base44CreateAppResult> {
    const response = await axios.post(
      `${this.baseUrl}/apps`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      },
    );

    const data = response.data;

    return {
      appId: data.id,
      appName: data.name,
      editorUrl: data.editorUrl,
      previewUrl: data.previewUrl,
    };
  }
}