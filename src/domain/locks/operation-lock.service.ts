import {
  ConditionalCheckFailedException,
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

export class OperationLockService {
  async acquire(input: OperationLockInput): Promise<void> {
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
}