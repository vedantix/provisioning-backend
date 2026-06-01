import {
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { env } from '../../../config/env';
import type { MetaEntityRecord, MetaEntityType } from '../types';

const INTERNAL_PK = 'META#VEDANTIX';
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
  return (error as { name?: string })?.name === 'ResourceInUseException';
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

export function metaInternalPk(): string {
  return INTERNAL_PK;
}

export function metaSk(entityType: MetaEntityType, id: string): string {
  return `${entityType}#${id}`;
}

export class MetaMarketingRepository {
  constructor(private readonly tableName = env.metaMarketingTable) {}

  async get<T extends MetaEntityRecord>(sk: string): Promise<T | null> {
    await this.ensureTableExists();
    const result = await ddb.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk: INTERNAL_PK, sk },
      }),
    );

    return (result.Item as T | undefined) ?? null;
  }

  async put<T extends MetaEntityRecord>(record: T): Promise<T> {
    await this.ensureTableExists();
    const clean = removeUndefinedValues(record);
    await ddb.send(
      new PutCommand({
        TableName: this.tableName,
        Item: clean,
      }),
    );
    return clean;
  }

  async listByType<T extends MetaEntityRecord>(
    entityType: MetaEntityType,
    limit = 100,
  ): Promise<T[]> {
    await this.ensureTableExists();
    const result = await ddb.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
        ExpressionAttributeValues: {
          ':pk': INTERNAL_PK,
          ':prefix': `${entityType}#`,
        },
        Limit: limit,
      }),
    );

    return ((result.Items ?? []) as T[]).filter((item) => !item.deletedAt);
  }

  async softDelete(sk: string, actorId?: string): Promise<void> {
    await this.ensureTableExists();
    await ddb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { pk: INTERNAL_PK, sk },
        UpdateExpression: 'SET deletedAt = :now, updatedAt = :now, updatedBy = :actorId',
        ExpressionAttributeValues: {
          ':now': new Date().toISOString(),
          ':actorId': actorId || 'system',
        },
      }),
    );
  }

  async healthScan(): Promise<number> {
    await this.ensureTableExists();
    const result = await ddb.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: {
          ':pk': INTERNAL_PK,
        },
        Limit: 5,
      }),
    );

    return result.Count ?? 0;
  }

  private async ensureTableExists(): Promise<void> {
    const existing = ensuredTables.get(this.tableName);
    if (existing) return existing;

    const promise = this.createTableIfMissing();
    ensuredTables.set(this.tableName, promise);

    try {
      await promise;
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
      if (!isResourceNotFound(error)) throw error;

      try {
        await client.send(
          new CreateTableCommand({
            TableName: this.tableName,
            BillingMode: 'PAY_PER_REQUEST',
            AttributeDefinitions: [
              { AttributeName: 'pk', AttributeType: 'S' },
              { AttributeName: 'sk', AttributeType: 'S' },
            ],
            KeySchema: [
              { AttributeName: 'pk', KeyType: 'HASH' },
              { AttributeName: 'sk', KeyType: 'RANGE' },
            ],
          }),
        );
      } catch (createError) {
        if (!isResourceInUse(createError)) throw createError;
      }
    }

    for (let attempt = 1; attempt <= 20; attempt += 1) {
      const result = await client.send(
        new DescribeTableCommand({ TableName: this.tableName }),
      );

      if (result.Table?.TableStatus === 'ACTIVE') return;
      await sleep(1500);
    }

    throw new Error(`DynamoDB table ${this.tableName} was created but is not ACTIVE yet`);
  }
}
