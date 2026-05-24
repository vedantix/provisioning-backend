import {
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
} from '@aws-sdk/client-dynamodb';
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
const ensuredTables = new Map<string, Promise<void>>();

function isResourceNotFound(error: unknown): boolean {
  const maybe = error as { name?: string; message?: string };
  return (
    maybe?.name === 'ResourceNotFoundException' ||
    String(maybe?.message || '').includes('Requested resource not found')
  );
}

function isResourceInUse(error: unknown): boolean {
  const maybe = error as { name?: string };
  return maybe?.name === 'ResourceInUseException';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
    let result;

    try {
      result = await ddb.send(
        new GetCommand({
          TableName: this.tableName,
          Key: { customerId },
        }),
      );
    } catch (error) {
      if (isResourceNotFound(error)) {
        return null;
      }

      throw error;
    }

    return (result.Item as AnalyticsIntegrationRecord | undefined) ?? null;
  }

  async findByDeploymentId(
    deploymentId: string,
  ): Promise<AnalyticsIntegrationRecord | null> {
    let result;

    try {
      result = await ddb.send(
        new ScanCommand({
          TableName: this.tableName,
          FilterExpression: 'deploymentId = :deploymentId',
          ExpressionAttributeValues: {
            ':deploymentId': deploymentId,
          },
          Limit: 1,
        }),
      );
    } catch (error) {
      if (isResourceNotFound(error)) {
        return null;
      }

      throw error;
    }

    return (result.Items?.[0] as AnalyticsIntegrationRecord | undefined) ?? null;
  }

  async upsert(record: AnalyticsIntegrationRecord): Promise<void> {
    await this.ensureTableExists();

    await ddb.send(
      new PutCommand({
        TableName: this.tableName,
        Item: removeUndefinedValues(record),
      }),
    );
  }

  async deleteByCustomerId(customerId: string): Promise<void> {
    await this.ensureTableExists();

    await ddb.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { customerId },
      }),
    );
  }

  private async ensureTableExists(): Promise<void> {
    const existing = ensuredTables.get(this.tableName);
    if (existing) {
      return existing;
    }

    const ensurePromise = this.createTableIfMissing();
    ensuredTables.set(this.tableName, ensurePromise);

    try {
      await ensurePromise;
    } catch (error) {
      ensuredTables.delete(this.tableName);
      throw error;
    }
  }

  private async createTableIfMissing(): Promise<void> {
    try {
      const result = await client.send(
        new DescribeTableCommand({
          TableName: this.tableName,
        }),
      );

      if (result.Table?.TableStatus === 'ACTIVE') {
        return;
      }
    } catch (error) {
      if (!isResourceNotFound(error)) {
        throw error;
      }

      try {
        await client.send(
          new CreateTableCommand({
            TableName: this.tableName,
            BillingMode: 'PAY_PER_REQUEST',
            AttributeDefinitions: [
              {
                AttributeName: 'customerId',
                AttributeType: 'S',
              },
            ],
            KeySchema: [
              {
                AttributeName: 'customerId',
                KeyType: 'HASH',
              },
            ],
          }),
        );
      } catch (createError) {
        if (!isResourceInUse(createError)) {
          throw createError;
        }
      }
    }

    for (let attempt = 1; attempt <= 20; attempt += 1) {
      const result = await client.send(
        new DescribeTableCommand({
          TableName: this.tableName,
        }),
      );

      if (result.Table?.TableStatus === 'ACTIVE') {
        return;
      }

      await sleep(1500);
    }

    throw new Error(`DynamoDB table ${this.tableName} was created but is not ACTIVE yet`);
  }
}
