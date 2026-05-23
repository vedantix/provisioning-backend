import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { env } from '../../../config/env';
import type { CustomerRecord, DeploymentInfo } from '../types/customer.types';
import type {
  MailDomainRecord,
  MailboxRecord,
} from '../../mail/types/mail.types';

const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client);
const TABLE_NAME = env.customersTable;

type StoredCustomerRecord = CustomerRecord;

function omitUndefinedFields<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, fieldValue]) => fieldValue !== undefined),
  ) as T;
}

export class CustomersRepository {
  async create(customer: CustomerRecord): Promise<void> {
    const item: StoredCustomerRecord = {
      ...customer,
    };

    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: item,
        ConditionExpression: 'attribute_not_exists(id)',
      }),
    );
  }

  async getById(customerId: string): Promise<CustomerRecord | null> {
    if (!customerId || typeof customerId !== 'string') {
      throw new Error('Invalid customerId');
    }

    const result = await ddb.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { id: customerId },
      }),
    );

    return (result.Item as CustomerRecord | undefined) ?? null;
  }

  async listByTenant(tenantId: string): Promise<CustomerRecord[]> {
    const result = await ddb.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: 'tenantId = :tenantId',
        ExpressionAttributeValues: {
          ':tenantId': tenantId,
        },
      }),
    );

    return ((result.Items as CustomerRecord[] | undefined) ?? []).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }

  async update(customer: CustomerRecord): Promise<void> {
    const item: StoredCustomerRecord = {
      ...customer,
    };

    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: item,
      }),
    );
  }

  async updateBase44Link(params: {
    customerId: string;
    tenantId: string;
    updatedAt: string;
    updatedBy: string;
    status: CustomerRecord['status'];
    websiteBuildStatus: CustomerRecord['websiteBuildStatus'];
    base44Status: CustomerRecord['base44']['status'];
    appId: string;
    appName?: string;
    editorUrl?: string;
    previewUrl?: string;
    templateKey?: string;
    niche?: string;
    requestedPrompt?: string;
    linkedAt: string;
  }): Promise<void> {
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { id: params.customerId },
        UpdateExpression: `
          SET
            #status = :status,
            websiteBuildStatus = :websiteBuildStatus,
            updatedAt = :updatedAt,
            updatedBy = :updatedBy,
            tenantId = :tenantId,

            base44.#base44Status = :base44Status,
            base44.appId = :appId,
            base44.appName = :appName,
            base44.editorUrl = :editorUrl,
            base44.previewUrl = :previewUrl,
            base44.templateKey = :templateKey,
            base44.niche = :niche,
            base44.requestedPrompt = :requestedPrompt,
            base44.linkedAt = :linkedAt
        `,
        ExpressionAttributeNames: {
          '#status': 'status',
          '#base44Status': 'status',
        },
        ExpressionAttributeValues: {
          ':status': params.status,
          ':websiteBuildStatus': params.websiteBuildStatus,
          ':updatedAt': params.updatedAt,
          ':updatedBy': params.updatedBy,
          ':tenantId': params.tenantId,

          ':base44Status': params.base44Status,
          ':appId': params.appId,
          ':appName': params.appName ?? null,
          ':editorUrl': params.editorUrl ?? null,
          ':previewUrl': params.previewUrl ?? null,
          ':templateKey': params.templateKey ?? null,
          ':niche': params.niche ?? null,
          ':requestedPrompt': params.requestedPrompt ?? null,
          ':linkedAt': params.linkedAt,
        },
      }),
    );
  }

  async updateWorkflowState(params: {
    customerId: string;
    updatedAt: string;
    updatedBy: string;
    status: CustomerRecord['status'];
    websiteBuildStatus: CustomerRecord['websiteBuildStatus'];
    previewUrl?: string;
    deploymentId?: string;
    deploymentStatus?: string;
    deploymentStage?: string | null;
    liveDomain?: string;
  }): Promise<void> {
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { id: params.customerId },
        UpdateExpression: `
          SET
            #status = :status,
            websiteBuildStatus = :websiteBuildStatus,
            updatedAt = :updatedAt,
            updatedBy = :updatedBy,
            base44.previewUrl = :previewUrl,
            deployment.deploymentId = :deploymentId,
            deployment.status = :deploymentStatus,
            deployment.currentStage = :deploymentStage,
            deployment.liveDomain = :liveDomain
        `,
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':status': params.status,
          ':websiteBuildStatus': params.websiteBuildStatus,
          ':updatedAt': params.updatedAt,
          ':updatedBy': params.updatedBy,
          ':previewUrl': params.previewUrl ?? null,
          ':deploymentId': params.deploymentId ?? null,
          ':deploymentStatus': params.deploymentStatus ?? null,
          ':deploymentStage': params.deploymentStage ?? null,
          ':liveDomain': params.liveDomain ?? null,
        },
      }),
    );
  }

  async markDeploymentLive(params: {
    customerId: string;
    updatedAt: string;
    updatedBy: string;
    deploymentId: string;
    deploymentStage?: string | null;
    liveDomain: string;
    distributionId?: string;
    repositoryName?: string;
  }): Promise<void> {
    const existing = await this.getById(params.customerId);
    if (!existing) {
      return;
    }

    const deployment = omitUndefinedFields<DeploymentInfo>({
      ...(existing.deployment || {}),
      deploymentId: params.deploymentId,
      status: 'SUCCEEDED',
      currentStage: params.deploymentStage ?? 'SQS',
      liveDomain: params.liveDomain,
      distributionId:
        params.distributionId ?? existing.deployment?.distributionId,
      repositoryName:
        params.repositoryName ?? existing.deployment?.repositoryName,
    });

    const updated: CustomerRecord = {
      ...existing,
      status: 'active',
      websiteBuildStatus: 'LIVE',
      updatedAt: params.updatedAt,
      updatedBy: params.updatedBy,
      preview: {
        ...existing.preview,
        status: 'ARCHIVED',
        updatedAt: params.updatedAt,
      },
      deployment,
    };

    await this.update(updated);
  }

  async markDeploymentOffline(params: {
    customerId: string;
    updatedAt: string;
    updatedBy: string;
    deploymentId?: string;
    liveDomain?: string;
  }): Promise<void> {
    const existing = await this.getById(params.customerId);
    if (!existing) {
      return;
    }

    const deployment = omitUndefinedFields<DeploymentInfo>({
      ...(existing.deployment || {}),
      deploymentId: params.deploymentId ?? existing.deployment?.deploymentId,
      status: 'OFFLINE',
      currentStage: 'FINALIZE_DELETE',
      liveDomain: params.liveDomain ?? existing.deployment?.liveDomain,
    });

    const updated: CustomerRecord = {
      ...existing,
      status: 'paused',
      websiteBuildStatus: 'COMPLETED',
      updatedAt: params.updatedAt,
      updatedBy: params.updatedBy,
      deployment,
    };

    await this.update(updated);
  }

  async markMailProvisioned(params: {
    customerId: string;
    updatedAt: string;
    updatedBy: string;
    mailDomain: MailDomainRecord;
    mailboxes: MailboxRecord[];
  }): Promise<CustomerRecord | null> {
    const existing = await this.getById(params.customerId);
    if (!existing) {
      return null;
    }

    const knownMailboxes = Array.isArray(existing.mailboxes)
      ? existing.mailboxes
      : [];
    const nextMailboxIds = new Set(params.mailboxes.map((mailbox) => mailbox.id));

    const updated: CustomerRecord = {
      ...existing,
      updatedAt: params.updatedAt,
      updatedBy: params.updatedBy,
      mailDomain: params.mailDomain,
      mailboxes: [
        ...params.mailboxes,
        ...knownMailboxes.filter((mailbox) => !nextMailboxIds.has(mailbox.id)),
      ],
      mail: {
        ...(existing.mail || {}),
        domainStatus: params.mailDomain.status,
        mailHostingEnabled: params.mailDomain.mailHostingEnabled,
        lastProvisionedAt: params.updatedAt,
      },
    };

    await this.update(updated);
    return updated;
  }
}
