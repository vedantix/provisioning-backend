import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { env } from '../../../config/env';
import type { AdminUserRecord } from '../types/admin-user.types';

const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client);
const TABLE_NAME = env.adminUsersTable;

export class AdminUsersRepository {
  async getById(id: string): Promise<AdminUserRecord | null> {
    const result = await ddb.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { id },
      }),
    );

    return (result.Item as AdminUserRecord | undefined) ?? null;
  }

  async getByEmail(
    tenantId: string,
    email: string,
  ): Promise<AdminUserRecord | null> {
    const normalizedEmail = email.trim().toLowerCase();

    const result = await ddb.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: 'tenantId = :tenantId AND email = :email',
        ExpressionAttributeValues: {
          ':tenantId': tenantId,
          ':email': normalizedEmail,
        },
        Limit: 1,
      }),
    );

    return (result.Items?.[0] as AdminUserRecord | undefined) ?? null;
  }

  async listByTenant(tenantId: string): Promise<AdminUserRecord[]> {
    const result = await ddb.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: 'tenantId = :tenantId',
        ExpressionAttributeValues: {
          ':tenantId': tenantId,
        },
      }),
    );

    return (result.Items as AdminUserRecord[] | undefined) ?? [];
  }

  async create(user: AdminUserRecord): Promise<void> {
    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: user,
        ConditionExpression: 'attribute_not_exists(id)',
      }),
    );
  }

  async updateLastLogin(id: string, at: string): Promise<void> {
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { id },
        UpdateExpression: 'SET lastLoginAt = :lastLoginAt, updatedAt = :updatedAt',
        ExpressionAttributeValues: {
          ':lastLoginAt': at,
          ':updatedAt': at,
        },
      }),
    );
  }
}