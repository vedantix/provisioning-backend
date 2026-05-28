import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { env } from '../../config/env';
import { logger } from '../../lib/logger';

const sqs = new SQSClient({ region: env.awsRegion });

export async function queueJob(payload: Record<string, unknown>) {
  const body = JSON.stringify(payload);
  const isFifoQueue = env.sqsQueueUrl.endsWith('.fifo');
  const stableId = [
    payload.deploymentId,
    payload.customerId,
    payload.type,
    payload.stage,
  ]
    .filter(Boolean)
    .join(':');

  const result = await sqs.send(
    new SendMessageCommand({
      QueueUrl: env.sqsQueueUrl,
      MessageBody: body,
      ...(isFifoQueue
        ? {
            MessageGroupId: String(payload.deploymentId || payload.customerId || 'vedantix'),
            MessageDeduplicationId: stableId || undefined,
          }
        : {}),
    }),
  );

  logger.info('SQS job queued', {
    messageId: result.MessageId,
    queueType: isFifoQueue ? 'FIFO' : 'STANDARD',
    deploymentId: payload.deploymentId,
    customerId: payload.customerId,
    type: payload.type,
  });

  return result.MessageId;
}
