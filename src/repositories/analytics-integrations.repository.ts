import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import { env } from '../config/env';
import type { AnalyticsIntegrationRecord } from '../services/analytics/analytics.types';

const client = new DynamoDBClient({ region: env.awsRegion });
const ddb = DynamoDBDocumentClient.from(client);

function removeUndefinedValues<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .filter((item) => item !== undefined)
      .map((item) => removeUndefinedValues(item)) as T;
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, removeUndefinedValues(item)]),
    ) as T;
  }

  return value;
}

export class AnalyticsIntegrationsRepository {
  constructor(private readonly tableName = env.analyticsIntegrationsTable) {}

  async getByCustomerId(customerId: string): Promise<AnalyticsIntegrationRecord | null> {
    const result = await ddb.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { customerId },
      }),
    );

    return (result.Item as AnalyticsIntegrationRecord | undefined) ?? null;
  }

  async findByDeploymentId(
    deploymentId: string,
  ): Promise<AnalyticsIntegrationRecord | null> {
    const result = await ddb.send(
      new ScanCommand({
        TableName: this.tableName,
        FilterExpression: 'deploymentId = :deploymentId',
        ExpressionAttributeValues: {
          ':deploymentId': deploymentId,
        },
        Limit: 1,
      }),
    );

    return (result.Items?.[0] as AnalyticsIntegrationRecord | undefined) ?? null;
  }

  async upsert(record: AnalyticsIntegrationRecord): Promise<void> {
    await ddb.send(
      new PutCommand({
        TableName: this.tableName,
        Item: removeUndefinedValues(record),
      }),
    );
  }

  async deleteByCustomerId(customerId: string): Promise<void> {
    await ddb.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { customerId },
      }),
    );
  }
}
