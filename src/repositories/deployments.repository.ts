// src/repositories/deployments.repository.ts
// VERVANG HELE FILE MET DEZE VERSIE

import {
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
import type {
  AnyStage,
  DeploymentRecord,
  FailureCategory,
  StageExecutionState,
} from '../domain/deployments/types';
import { env } from '../config/env';

const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client);
const TABLE_NAME = process.env.DEPLOYMENTS_TABLE || 'vedantix-deployments';

type StoredDeploymentRecord = DeploymentRecord & { id: string };

export class DeploymentsRepository {
  async getById(deploymentId: string): Promise<DeploymentRecord | null> {
    const result = await ddb.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { id: deploymentId },
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

  async listByTenantAndDomain(
    tenantId: string,
    domain: string,
  ): Promise<DeploymentRecord[]> {
    const result = await ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'tenantId-domain-index',
        KeyConditionExpression: 'tenantId = :tenantId AND #domain = :domain',
        ExpressionAttributeNames: {
          '#domain': 'domain',
        },
        ExpressionAttributeValues: {
          ':tenantId': tenantId,
          ':domain': domain,
        },
      }),
    );

    return ((result.Items as DeploymentRecord[] | undefined) ?? []).sort(
      (a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')),
    );
  }

  async listCleanupCandidates(params?: {
    tenantId?: string;
    limit?: number;
  }): Promise<DeploymentRecord[]> {
    const limit = params?.limit ?? 50;

    const result = await ddb.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        Limit: limit,
      }),
    );

    const items = (result.Items as DeploymentRecord[] | undefined) ?? [];

    return items
      .filter((item) => {
        if (params?.tenantId && item.tenantId !== params.tenantId) {
          return false;
        }

        return item.status === 'FAILED' || item.status === 'DELETING';
      })
      .slice(0, limit);
  }

  async create(deployment: DeploymentRecord): Promise<void> {
    const item: StoredDeploymentRecord = {
      ...(deployment as StoredDeploymentRecord),
      id: deployment.deploymentId,
    };

    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: item,
        ConditionExpression: 'attribute_not_exists(id)',
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
        Key: { id: deploymentId },
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
        Key: { id: deploymentId },
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
    const shouldClearFailure = existing?.failureStage === stage;

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
        Key: { id: deploymentId },
        UpdateExpression: shouldClearFailure
          ? 'SET lastSuccessfulStage = :lastSuccessfulStage, updatedAt = :updatedAt, stageStates.#stageKey = :stageState REMOVE failureStage, failureCategory ADD version :inc'
          : 'SET lastSuccessfulStage = :lastSuccessfulStage, updatedAt = :updatedAt, stageStates.#stageKey = :stageState ADD version :inc',
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
    const retryCount = previousRetryCount + 1;
    const retryable = params.retryable ?? false;
    const delayMs = Math.min(
      env.analyticsRetryBaseDelayMs * 2 ** Math.max(0, retryCount - 1),
      env.analyticsRetryMaxDelayMs,
    );
    const nextRetryAt =
      retryable && retryCount < env.maxStageRetryCount
        ? new Date(Date.now() + delayMs).toISOString()
        : undefined;

    const stageState: StageExecutionState = {
      stage,
      status: 'FAILED',
      retryCount,
      startedAt: previousStartedAt,
      completedAt: now,
      lastErrorCode: params.errorCode,
      lastErrorMessage: params.errorMessage,
      retryable,
      nextRetryAt,
      retryHistory: [
        ...((existing?.stageStates?.[stage]?.retryHistory ?? []).slice(-9)),
        {
          attempt: retryCount,
          errorCode: params.errorCode,
          errorMessage: params.errorMessage,
          at: now,
          nextRetryAt,
        },
      ],
    };

    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { id: deploymentId },
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
        Key: { id: deploymentId },
        UpdateExpression:
          'SET #status = :status, updatedAt = :updatedAt REMOVE failureStage, failureCategory ADD version :inc',
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
        Key: { id: deploymentId },
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

  async markDeploymentOffline(
    deploymentId: string,
    now: string,
  ): Promise<void> {
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { id: deploymentId },
        UpdateExpression:
          'SET #status = :status, currentStage = :currentStage, updatedAt = :updatedAt ADD version :inc',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':status': 'OFFLINE',
          ':currentStage': 'FINALIZE_DELETE',
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
        Key: { id: deploymentId },
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
