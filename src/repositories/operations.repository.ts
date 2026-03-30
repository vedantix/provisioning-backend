import {
  DynamoDBClient,
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { OperationRecord } from '../domain/deployments/types';

const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client);
const TABLE_NAME = process.env.JOBS_TABLE || process.env.OPERATIONS_TABLE || 'vedantix-operations';

export class OperationsRepository {
  async getById(operationId: string): Promise<OperationRecord | null> {
    const result = await ddb.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { operationId },
      }),
    );

    return (result.Item as OperationRecord | undefined) ?? null;
  }

  async findByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<OperationRecord | null> {
    const result = await ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'idempotencyKey-index',
        KeyConditionExpression: 'idempotencyKey = :idempotencyKey',
        ExpressionAttributeValues: {
          ':idempotencyKey': idempotencyKey,
        },
        Limit: 1,
        ScanIndexForward: false,
      }),
    );

    return (result.Items?.[0] as OperationRecord | undefined) ?? null;
  }

  async listByDeploymentId(
    deploymentId: string,
  ): Promise<OperationRecord[]> {
    const result = await ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'deploymentId-createdAt-index',
        KeyConditionExpression: 'deploymentId = :deploymentId',
        ExpressionAttributeValues: {
          ':deploymentId': deploymentId,
        },
        ScanIndexForward: false,
      }),
    );

    return (result.Items as OperationRecord[] | undefined) ?? [];
  }

  async create(operation: OperationRecord): Promise<void> {
    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: operation,
        ConditionExpression: 'attribute_not_exists(operationId)',
      }),
    );
  }

  async markRunning(operationId: string, now: string): Promise<void> {
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { operationId },
        UpdateExpression: 'SET #status = :status, startedAt = :startedAt, updatedAt = :updatedAt',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':status': 'RUNNING',
          ':startedAt': now,
          ':updatedAt': now,
        },
      }),
    );
  }

  async markSucceeded(operationId: string, now: string): Promise<void> {
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { operationId },
        UpdateExpression:
          'SET #status = :status, completedAt = :completedAt, updatedAt = :updatedAt',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':status': 'SUCCEEDED',
          ':completedAt': now,
          ':updatedAt': now,
        },
      }),
    );
  }

  async markFailed(
    operationId: string,
    now: string,
    errorCode: string,
    errorMessage: string,
  ): Promise<void> {
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { operationId },
        UpdateExpression:
          'SET #status = :status, completedAt = :completedAt, updatedAt = :updatedAt, errorCode = :errorCode, errorMessage = :errorMessage',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':status': 'FAILED',
          ':completedAt': now,
          ':updatedAt': now,
          ':errorCode': errorCode,
          ':errorMessage': errorMessage,
        },
      }),
    );
  }
}