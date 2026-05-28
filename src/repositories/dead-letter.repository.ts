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
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import crypto from 'node:crypto';
import { env } from '../config/env';

export type DeadLetterStatus = 'OPEN' | 'REPLAYED' | 'RESOLVED';

export type DeadLetterRecord = {
  deadLetterId: string;
  tenantId: string;
  resourceType: 'ANALYTICS' | 'DEPLOYMENT' | 'QUEUE';
  resourceId: string;
  customerId?: string;
  deploymentId?: string;
  operationId?: string;
  provider?: string;
  stage?: string;
  errorCode?: string;
  errorMessage: string;
  attempts: number;
  payload?: Record<string, unknown>;
  status: DeadLetterStatus;
  createdAt: string;
  updatedAt: string;
};

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

export class DeadLetterRepository {
  constructor(private readonly tableName = env.deadLetterTable) {}

  async create(
    input: Omit<DeadLetterRecord, 'deadLetterId' | 'status' | 'createdAt' | 'updatedAt'>,
  ): Promise<DeadLetterRecord> {
    await this.ensureTableExists();
    const now = new Date().toISOString();
    const record: DeadLetterRecord = {
      deadLetterId: crypto.randomUUID(),
      ...input,
      status: 'OPEN',
      createdAt: now,
      updatedAt: now,
    };

    await ddb.send(
      new PutCommand({
        TableName: this.tableName,
        Item: removeUndefinedValues(record),
        ConditionExpression: 'attribute_not_exists(deadLetterId)',
      }),
    );

    return record;
  }

  async listOpenByTenant(tenantId: string, limit = 50): Promise<DeadLetterRecord[]> {
    await this.ensureTableExists();

    const result = await ddb.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'tenantId-status-createdAt-index',
        KeyConditionExpression: 'tenantId = :tenantId AND #status = :status',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':tenantId': tenantId,
          ':status': 'OPEN',
        },
        ScanIndexForward: false,
        Limit: limit,
      }),
    );

    return (result.Items as DeadLetterRecord[] | undefined) ?? [];
  }

  async getById(deadLetterId: string): Promise<DeadLetterRecord | null> {
    await this.ensureTableExists();

    const result = await ddb.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { deadLetterId },
      }),
    );

    return (result.Item as DeadLetterRecord | undefined) ?? null;
  }

  async markStatus(deadLetterId: string, status: DeadLetterStatus): Promise<void> {
    await this.ensureTableExists();

    await ddb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { deadLetterId },
        UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':status': status,
          ':updatedAt': new Date().toISOString(),
        },
      }),
    );
  }

  async healthScan(limit = 5): Promise<number> {
    await this.ensureTableExists();
    const result = await ddb.send(
      new ScanCommand({
        TableName: this.tableName,
        Limit: limit,
      }),
    );

    return result.Count ?? 0;
  }

  private async ensureTableExists(): Promise<void> {
    const existing = ensuredTables.get(this.tableName);
    if (existing) {
      return existing;
    }

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
        new DescribeTableCommand({ TableName: this.tableName }),
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
              { AttributeName: 'deadLetterId', AttributeType: 'S' },
              { AttributeName: 'tenantId', AttributeType: 'S' },
              { AttributeName: 'status', AttributeType: 'S' },
            ],
            KeySchema: [{ AttributeName: 'deadLetterId', KeyType: 'HASH' }],
            GlobalSecondaryIndexes: [
              {
                IndexName: 'tenantId-status-createdAt-index',
                KeySchema: [
                  { AttributeName: 'tenantId', KeyType: 'HASH' },
                  { AttributeName: 'status', KeyType: 'RANGE' },
                ],
                Projection: { ProjectionType: 'ALL' },
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
        new DescribeTableCommand({ TableName: this.tableName }),
      );

      if (result.Table?.TableStatus === 'ACTIVE') {
        return;
      }

      await sleep(1500);
    }

    throw new Error(`DynamoDB table ${this.tableName} was created but is not ACTIVE yet`);
  }
}
