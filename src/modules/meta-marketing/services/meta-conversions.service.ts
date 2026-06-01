import crypto from 'node:crypto';
import { env } from '../../../config/env';
import { AppError } from '../../../errors/app-error';
import { MetaAuthService } from './meta-auth.service';
import { MetaApiClient } from './meta-api-client';

type ConversionEventInput = {
  tenantId: string;
  eventName: 'PageView' | 'Lead' | 'Contact' | 'Schedule' | 'Purchase';
  eventSourceUrl?: string;
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  fbp?: string;
  fbc?: string;
  value?: number;
  currency?: string;
  eventId?: string;
};

function hash(value?: string): string | undefined {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return undefined;
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

export class MetaConversionsService {
  constructor(
    private readonly auth = new MetaAuthService(),
    private readonly api = new MetaApiClient(),
  ) {}

  pixelSnippet(pixelId?: string): string {
    const id = pixelId || env.metaPixelId;
    if (!id) {
      throw new AppError('Meta Pixel ID is not configured', 409, 'META_PIXEL_ID_MISSING');
    }

    return [
      '<!-- Meta Pixel Code -->',
      '<script>',
      '!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?',
      "n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;",
      "n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;",
      "t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');",
      `fbq('init','${id}');fbq('track','PageView');`,
      '</script>',
      `<noscript><img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id=${id}&ev=PageView&noscript=1"/></noscript>`,
      '<!-- End Meta Pixel Code -->',
    ].join('');
  }

  async sendEvent(input: ConversionEventInput): Promise<unknown> {
    const connection = await this.auth.getConnection(input.tenantId);
    const pixelId = connection.pixelId || env.metaPixelId;
    if (!pixelId) {
      throw new AppError('Meta Pixel ID is required for Conversions API', 409, 'META_PIXEL_ID_MISSING');
    }
    const token = await this.auth.getAccessToken(input.tenantId);
    return this.api.request(`/${pixelId}/events`, {
      method: 'POST',
      token,
      body: {
        data: [
          {
            event_name: input.eventName,
            event_time: Math.floor(Date.now() / 1000),
            event_id: input.eventId || crypto.randomUUID(),
            action_source: 'website',
            event_source_url: input.eventSourceUrl,
            user_data: {
              em: hash(input.email),
              ph: hash(input.phone),
              fn: hash(input.firstName),
              ln: hash(input.lastName),
              fbp: input.fbp,
              fbc: input.fbc,
            },
            custom_data: {
              value: input.value,
              currency: input.currency || 'EUR',
            },
          },
        ],
        test_event_code: env.metaConversionsApiTestEventCode,
      },
    });
  }
}
