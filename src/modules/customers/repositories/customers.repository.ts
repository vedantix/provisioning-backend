import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { env } from '../../../config/env';
import type { CustomerRecord } from '../types/customer.types';

const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client);
const TABLE_NAME = env.customersTable;

type StoredCustomerRecord = CustomerRecord & { pk: string };

export class CustomersRepository {
  async create(customer: CustomerRecord): Promise<void> {
    const item: StoredCustomerRecord = {
      ...customer,
      pk: customer.id,
    };

    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: item,
        ConditionExpression: 'attribute_not_exists(pk)',
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
        Key: { pk: customerId },
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
      pk: customer.id,
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
        Key: { pk: params.customerId },

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
}