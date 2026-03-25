import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { env } from '../../config/env';

const sqs = new SQSClient({ region: env.awsRegion });

export async function queueJob(payload: Record<string, unknown>) {
  const result = await sqs.send(new SendMessageCommand({
    QueueUrl: env.sqsQueueUrl,
    MessageBody: JSON.stringify(payload)
  }));

  return result.MessageId;
}