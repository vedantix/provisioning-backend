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

export type OperationLockInput = {
  deploymentId: string;
  operationId: string;
  stage?: string;
  ttlSeconds: number;
  owner: {
    tenantId: string;
    actorId?: string;
    requestId?: string;
  };
};

export class OperationLockConflictError extends Error {
  constructor(message = 'Another operation lock is already active') {
    super(message);
    this.name = 'OperationLockConflictError';
  }
}

const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client);
const TABLE_NAME =
  process.env.OPERATION_LOCKS_TABLE || 'vedantix-operation-locks';
let ensuredTable: Promise<void> | undefined;

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

export class OperationLockService {
  async acquire(input: OperationLockInput): Promise<void> {
    await this.ensureTableExists();
    const nowEpoch = Math.floor(Date.now() / 1000);
    const expiresAtEpochSeconds = nowEpoch + input.ttlSeconds;

    try {
      await ddb.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: {
            lockId: this.buildLockId(input.deploymentId),
            deploymentId: input.deploymentId,
            operationId: input.operationId,
            stage: input.stage,
            tenantId: input.owner.tenantId,
            actorId: input.owner.actorId,
            requestId: input.owner.requestId,
            createdAt: new Date().toISOString(),
            expiresAt: expiresAtEpochSeconds,
          },
          ConditionExpression:
            'attribute_not_exists(lockId) OR expiresAt < :nowEpoch',
          ExpressionAttributeValues: {
            ':nowEpoch': nowEpoch,
          },
        }),
      );
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) {
        throw new OperationLockConflictError();
      }

      throw error;
    }
  }

  async refresh(
    deploymentId: string,
    operationId: string,
    ttlSeconds: number,
  ): Promise<void> {
    await this.ensureTableExists();
    const nowEpoch = Math.floor(Date.now() / 1000);
    const expiresAtEpochSeconds = nowEpoch + ttlSeconds;

    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          lockId: this.buildLockId(deploymentId),
        },
        UpdateExpression:
          'SET expiresAt = :expiresAt, updatedAt = :updatedAt',
        ConditionExpression: 'operationId = :operationId',
        ExpressionAttributeValues: {
          ':expiresAt': expiresAtEpochSeconds,
          ':updatedAt': new Date().toISOString(),
          ':operationId': operationId,
        },
      }),
    );
  }

  async release(deploymentId: string, operationId?: string): Promise<void> {
    await this.ensureTableExists();
    if (!operationId) {
      await ddb.send(
        new DeleteCommand({
          TableName: TABLE_NAME,
          Key: {
            lockId: this.buildLockId(deploymentId),
          },
        }),
      );
      return;
    }

    const existing = await this.get(deploymentId);
    if (!existing) {
      return;
    }

    if (existing.operationId !== operationId) {
      return;
    }

    await ddb.send(
      new DeleteCommand({
        TableName: TABLE_NAME,
        Key: {
          lockId: this.buildLockId(deploymentId),
        },
      }),
    );
  }

  async get(
    deploymentId: string,
  ): Promise<
    | {
        lockId: string;
        deploymentId: string;
        operationId: string;
        expiresAt: number;
        tenantId?: string;
        actorId?: string;
        requestId?: string;
        stage?: string;
      }
    | undefined
  > {
    await this.ensureTableExists();
    const result = await ddb.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          lockId: this.buildLockId(deploymentId),
        },
      }),
    );

    return result.Item as
      | {
          lockId: string;
          deploymentId: string;
          operationId: string;
          expiresAt: number;
          tenantId?: string;
          actorId?: string;
          requestId?: string;
          stage?: string;
        }
      | undefined;
  }

  private buildLockId(deploymentId: string): string {
    return `deployment:${deploymentId}`;
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
        new DescribeTableCommand({ TableName: TABLE_NAME }),
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
            TableName: TABLE_NAME,
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
        new DescribeTableCommand({ TableName: TABLE_NAME }),
      );

      if (result.Table?.TableStatus === 'ACTIVE') {
        return;
      }

      await sleep(1500);
    }

    throw new Error(`DynamoDB table ${TABLE_NAME} was created but is not ACTIVE yet`);
  }
}
