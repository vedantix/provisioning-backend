import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { env } from '../../config/env';

const client = new DynamoDBClient({ region: env.awsRegion });
const docClient = DynamoDBDocumentClient.from(client);

export async function putDeployment(item: Record<string, unknown>) {
  await docClient.send(new PutCommand({
    TableName: env.deploymentsTable,
    Item: item
  }));
}

export async function putJob(item: Record<string, unknown>) {
  await docClient.send(new PutCommand({
    TableName: env.jobsTable,
    Item: item
  }));
}