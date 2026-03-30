import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import type { AuditEvent } from '../domain/audit/audit.types';

const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client);
const TABLE_NAME = process.env.AUDIT_TABLE || 'vedantix-audit';

export class AuditRepository {
  async create(event: AuditEvent): Promise<void> {
    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: event,
      }),
    );
  }

  async listByDeploymentId(deploymentId: string): Promise<AuditEvent[]> {
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

    return (result.Items as AuditEvent[] | undefined) ?? [];
  }
}