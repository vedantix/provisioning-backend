import crypto from 'node:crypto';
import { env } from '../../../config/env';
import { AppError, ForbiddenError } from '../../../errors/app-error';
import { logger } from '../../../lib/logger';
import { MetaLeadService } from './meta-lead.service';

type MetaWebhookPayload = {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value?: {
        leadgen_id?: string;
      };
    }>;
  }>;
};

export class MetaWebhookService {
  constructor(private readonly leadService = new MetaLeadService()) {}

  verify(query: Record<string, unknown>): string {
    if (!env.metaWebhookVerifyToken) {
      throw new AppError('META_WEBHOOK_VERIFY_TOKEN is not configured', 500, 'META_WEBHOOK_CONFIG_MISSING');
    }
    const mode = String(query['hub.mode'] || '');
    const token = String(query['hub.verify_token'] || '');
    const challenge = String(query['hub.challenge'] || '');
    if (mode !== 'subscribe' || token !== env.metaWebhookVerifyToken) {
      throw new ForbiddenError('Invalid Meta webhook verification token');
    }
    return challenge;
  }

  async handle(input: {
    tenantId: string;
    payload: MetaWebhookPayload;
    rawBody?: Buffer | string;
    signature?: string;
  }): Promise<{ processed: number }> {
    this.assertSignature(input.signature, input.rawBody);
    let processed = 0;
    for (const entry of input.payload.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field !== 'leadgen' || !change.value?.leadgen_id) {
          continue;
        }

        await this.leadService.ingestLeadgenId({
          tenantId: input.tenantId,
          actorId: 'meta-webhook',
          leadgenId: change.value.leadgen_id,
        });
        processed += 1;
      }
    }
    logger.info('Meta webhook processed', {
      provider: 'META',
      processed,
      object: input.payload.object,
    });
    return { processed };
  }

  private assertSignature(signature: string | undefined, rawBody: Buffer | string | undefined): void {
    if (!env.metaAppSecret) {
      return;
    }

    if (!signature || !signature.startsWith('sha256=') || !rawBody) {
      throw new ForbiddenError('Meta webhook signature is required');
    }

    const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');
    const expected = `sha256=${crypto
      .createHmac('sha256', env.metaAppSecret)
      .update(body)
      .digest('hex')}`;
    const providedBuffer = Buffer.from(signature, 'utf8');
    const expectedBuffer = Buffer.from(expected, 'utf8');
    const matches = providedBuffer.length === expectedBuffer.length &&
      crypto.timingSafeEqual(providedBuffer, expectedBuffer);

    if (!matches) {
      throw new ForbiddenError('Invalid Meta webhook signature');
    }
  }
}
