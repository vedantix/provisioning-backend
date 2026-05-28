import {
  ConditionalCheckFailedException,
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
} from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { env } from '../../config/env';

export type DistributedLockOwner = {
  tenantId: string;
  actorId?: string;
  requestId?: string;
  operationId: string;
};

export type DistributedLockRecord = {
  lockId: string;
  resourceType: string;
  resourceId: string;
  tenantId: string;
  actorId?: string;
  requestId?: string;
  operationId: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: number;
};

export class DistributedLockConflictError extends Error {
  constructor(
    message = 'Another operation is already active for this resource',
    public readonly lock?: DistributedLockRecord,
  ) {
    super(message);
    this.name = 'DistributedLockConflictError';
  }
}

const client = new DynamoDBClient({ region: env.awsRegion });
const ddb = DynamoDBDocumentClient.from(client);
const tableName = process.env.OPERATION_LOCKS_TABLE || 'vedantix-operation-locks';
let ensuredTable: Promise<void> | undefined;

function nowEpoch(): number {
  return Math.floor(Date.now() / 1000);
}

function lockId(resourceType: string, resourceId: string): string {
  return `${resourceType}:${resourceId}`;
}

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

export class DistributedLockService {
  async acquire(input: {
    resourceType: string;
    resourceId: string;
    ttlSeconds: number;
    owner: DistributedLockOwner;
  }): Promise<DistributedLockRecord> {
    const createdAt = new Date().toISOString();
    await this.ensureTableExists();
    const record: DistributedLockRecord = {
      lockId: lockId(input.resourceType, input.resourceId),
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      tenantId: input.owner.tenantId,
      actorId: input.owner.actorId,
      requestId: input.owner.requestId,
      operationId: input.owner.operationId,
      createdAt,
      updatedAt: createdAt,
      expiresAt: nowEpoch() + input.ttlSeconds,
    };

    try {
      await ddb.send(
        new PutCommand({
          TableName: tableName,
          Item: record,
          ConditionExpression:
            'attribute_not_exists(lockId) OR expiresAt < :nowEpoch OR operationId = :operationId',
          ExpressionAttributeValues: {
            ':nowEpoch': nowEpoch(),
            ':operationId': input.owner.operationId,
          },
        }),
      );
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) {
        throw new DistributedLockConflictError(undefined, await this.get(input.resourceType, input.resourceId));
      }

      throw error;
    }

    return record;
  }

  async refresh(input: {
    resourceType: string;
    resourceId: string;
    operationId: string;
    ttlSeconds: number;
  }): Promise<void> {
    await this.ensureTableExists();
    await ddb.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { lockId: lockId(input.resourceType, input.resourceId) },
        UpdateExpression: 'SET expiresAt = :expiresAt, updatedAt = :updatedAt',
        ConditionExpression: 'operationId = :operationId',
        ExpressionAttributeValues: {
          ':expiresAt': nowEpoch() + input.ttlSeconds,
          ':updatedAt': new Date().toISOString(),
          ':operationId': input.operationId,
        },
      }),
    );
  }

  async release(input: {
    resourceType: string;
    resourceId: string;
    operationId: string;
  }): Promise<void> {
    await this.ensureTableExists();
    const existing = await this.get(input.resourceType, input.resourceId);
    if (!existing || existing.operationId !== input.operationId) {
      return;
    }

    await ddb.send(
      new DeleteCommand({
        TableName: tableName,
        Key: { lockId: lockId(input.resourceType, input.resourceId) },
      }),
    );
  }

  async get(
    resourceType: string,
    resourceId: string,
  ): Promise<DistributedLockRecord | undefined> {
    await this.ensureTableExists();
    const result = await ddb.send(
      new GetCommand({
        TableName: tableName,
        Key: { lockId: lockId(resourceType, resourceId) },
      }),
    );

    return result.Item as DistributedLockRecord | undefined;
  }

  private async ensureTableExists(): Promise<void> {
    if (!ensuredTable) {
      ensuredTable = this.createTableIfMissing().catch((error) => {
        ensuredTable = undefined;
        throw error;
      });
    }

    return ensuredTable;
  }

  private async createTableIfMissing(): Promise<void> {
    try {
      const result = await client.send(
        new DescribeTableCommand({ TableName: tableName }),
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
            TableName: tableName,
            BillingMode: 'PAY_PER_REQUEST',
            AttributeDefinitions: [{ AttributeName: 'lockId', AttributeType: 'S' }],
            KeySchema: [{ AttributeName: 'lockId', KeyType: 'HASH' }],
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
        new DescribeTableCommand({ TableName: tableName }),
      );

      if (result.Table?.TableStatus === 'ACTIVE') {
        return;
      }

      await sleep(1500);
    }

    throw new Error(`DynamoDB table ${tableName} was created but is not ACTIVE yet`);
  }
}
