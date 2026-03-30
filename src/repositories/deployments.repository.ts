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
import type {
  AnyStage,
  DeploymentRecord,
  FailureCategory,
  StageExecutionState,
} from '../domain/deployments/types';

const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client);
const TABLE_NAME = process.env.DEPLOYMENTS_TABLE || 'vedantix-deployments';

export class DeploymentsRepository {
  async getById(deploymentId: string): Promise<DeploymentRecord | null> {
    const result = await ddb.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { deploymentId },
      }),
    );

    return (result.Item as DeploymentRecord | undefined) ?? null;
  }

  async findActiveByTenantAndDomain(
    tenantId: string,
    domain: string,
  ): Promise<DeploymentRecord | null> {
    const result = await ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'tenantId-domain-index',
        KeyConditionExpression: 'tenantId = :tenantId AND #domain = :domain',
        FilterExpression: '#status IN (:pending, :inProgress, :deleting)',
        ExpressionAttributeNames: {
          '#domain': 'domain',
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':tenantId': tenantId,
          ':domain': domain,
          ':pending': 'PENDING',
          ':inProgress': 'IN_PROGRESS',
          ':deleting': 'DELETING',
        },
        Limit: 1,
      }),
    );

    return (result.Items?.[0] as DeploymentRecord | undefined) ?? null;
  }

  async create(deployment: DeploymentRecord): Promise<void> {
    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: deployment,
        ConditionExpression: 'attribute_not_exists(deploymentId)',
      }),
    );
  }

  async markInProgress(
    deploymentId: string,
    stage: AnyStage,
    now: string,
  ): Promise<void> {
    const existing = await this.getById(deploymentId);
    const previousRetryCount = existing?.stageStates?.[stage]?.retryCount ?? 0;
    const previousStartedAt = existing?.stageStates?.[stage]?.startedAt;

    const stageState: StageExecutionState = {
      stage,
      status: 'IN_PROGRESS',
      retryCount: previousRetryCount,
      startedAt: previousStartedAt ?? now,
    };

    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { deploymentId },
        UpdateExpression:
          'SET #status = :status, currentStage = :currentStage, updatedAt = :updatedAt, stageStates.#stageKey = :stageState ADD version :inc',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#stageKey': stage,
        },
        ExpressionAttributeValues: {
          ':status': 'IN_PROGRESS',
          ':currentStage': stage,
          ':updatedAt': now,
          ':stageState': stageState,
          ':inc': 1,
        },
      }),
    );
  }

  async markDeleting(
    deploymentId: string,
    stage: AnyStage,
    now: string,
  ): Promise<void> {
    const existing = await this.getById(deploymentId);
    const previousRetryCount = existing?.stageStates?.[stage]?.retryCount ?? 0;
    const previousStartedAt = existing?.stageStates?.[stage]?.startedAt;

    const stageState: StageExecutionState = {
      stage,
      status: 'IN_PROGRESS',
      retryCount: previousRetryCount,
      startedAt: previousStartedAt ?? now,
    };

    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { deploymentId },
        UpdateExpression:
          'SET #status = :status, currentStage = :currentStage, updatedAt = :updatedAt, stageStates.#stageKey = :stageState ADD version :inc',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#stageKey': stage,
        },
        ExpressionAttributeValues: {
          ':status': 'DELETING',
          ':currentStage': stage,
          ':updatedAt': now,
          ':stageState': stageState,
          ':inc': 1,
        },
      }),
    );
  }

  async markStageSucceeded(
    deploymentId: string,
    stage: AnyStage,
    now: string,
    output?: Record<string, unknown>,
  ): Promise<void> {
    const existing = await this.getById(deploymentId);
    const previousRetryCount = existing?.stageStates?.[stage]?.retryCount ?? 0;
    const previousStartedAt = existing?.stageStates?.[stage]?.startedAt;

    const stageState: StageExecutionState = {
      stage,
      status: 'SUCCEEDED',
      retryCount: previousRetryCount,
      startedAt: previousStartedAt,
      completedAt: now,
      output,
    };

    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { deploymentId },
        UpdateExpression:
          'SET lastSuccessfulStage = :lastSuccessfulStage, updatedAt = :updatedAt, stageStates.#stageKey = :stageState ADD version :inc',
        ExpressionAttributeNames: {
          '#stageKey': stage,
        },
        ExpressionAttributeValues: {
          ':lastSuccessfulStage': stage,
          ':updatedAt': now,
          ':stageState': stageState,
          ':inc': 1,
        },
      }),
    );
  }

  async markStageFailed(
    deploymentId: string,
    stage: AnyStage,
    now: string,
    params: {
      errorCode: string;
      errorMessage: string;
      retryable?: boolean;
      failureCategory?: FailureCategory;
    },
  ): Promise<void> {
    const existing = await this.getById(deploymentId);
    const previousRetryCount = existing?.stageStates?.[stage]?.retryCount ?? 0;
    const previousStartedAt = existing?.stageStates?.[stage]?.startedAt;

    const stageState: StageExecutionState = {
      stage,
      status: 'FAILED',
      retryCount: previousRetryCount + 1,
      startedAt: previousStartedAt,
      completedAt: now,
      lastErrorCode: params.errorCode,
      lastErrorMessage: params.errorMessage,
      retryable: params.retryable ?? false,
    };

    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { deploymentId },
        UpdateExpression:
          'SET #status = :status, failureStage = :failureStage, currentStage = :currentStage, failureCategory = :failureCategory, updatedAt = :updatedAt, stageStates.#stageKey = :stageState ADD version :inc',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#stageKey': stage,
        },
        ExpressionAttributeValues: {
          ':status': 'FAILED',
          ':failureStage': stage,
          ':currentStage': stage,
          ':failureCategory': params.failureCategory ?? 'UNKNOWN',
          ':updatedAt': now,
          ':stageState': stageState,
          ':inc': 1,
        },
      }),
    );
  }

  async markDeploymentSucceeded(
    deploymentId: string,
    now: string,
  ): Promise<void> {
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { deploymentId },
        UpdateExpression:
          'SET #status = :status, updatedAt = :updatedAt ADD version :inc',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':status': 'SUCCEEDED',
          ':updatedAt': now,
          ':inc': 1,
        },
      }),
    );
  }

  async markDeploymentDeleted(
    deploymentId: string,
    now: string,
  ): Promise<void> {
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { deploymentId },
        UpdateExpression:
          'SET #status = :status, deletedAt = :deletedAt, updatedAt = :updatedAt ADD version :inc',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':status': 'DELETED',
          ':deletedAt': now,
          ':updatedAt': now,
          ':inc': 1,
        },
      }),
    );
  }

  async updateManagedResources(
    deploymentId: string,
    managedResources: Record<string, unknown>,
    now: string,
  ): Promise<void> {
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { deploymentId },
        UpdateExpression:
          'SET managedResources = :managedResources, updatedAt = :updatedAt ADD version :inc',
        ExpressionAttributeValues: {
          ':managedResources': managedResources,
          ':updatedAt': now,
          ':inc': 1,
        },
      }),
    );
  }
}