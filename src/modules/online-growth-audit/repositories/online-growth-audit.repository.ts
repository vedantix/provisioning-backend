import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { env } from '../../../config/env';
import type {
  AuditRecord,
  AuditRequest,
  AuditResult,
  AuditStatus,
} from '../types/online-growth-audit.types';

const client = new DynamoDBClient({ region: env.awsRegion });
const ddb = DynamoDBDocumentClient.from(client, {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});

const AUDIT_RETENTION_DAYS = 90;
const AUDIT_RETENTION_MS = AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1_000;

type StoredAuditRecord = AuditRecord & {
  tenantPk?: string;
  expiresAt?: number;
};

function pk(id: string): string {
  return `AUDIT#${id}`;
}

function tenantIndexPk(tenantId: string): string {
  return `TENANT#${tenantId}`;
}

function nowEpochSeconds(): number {
  return Math.floor(Date.now() / 1_000);
}

function isExpired(record: StoredAuditRecord): boolean {
  return typeof record.expiresAt === 'number' && record.expiresAt <= nowEpochSeconds();
}

export function auditExpiresAt(createdDate: string): number {
  const parsed = Date.parse(createdDate);
  const base = Number.isNaN(parsed) ? Date.now() : parsed;
  return Math.floor((base + AUDIT_RETENTION_MS) / 1_000);
}

export class OnlineGrowthAuditRepository {
  constructor(private readonly tableName = env.onlineGrowthAuditsTable) {}

  async createRequest(request: AuditRequest): Promise<void> {
    const record: AuditRecord = {
      ...request,
      pk: pk(request.id),
      sk: 'REQUEST',
      entityType: 'AUDIT_REQUEST',
    };

    await ddb.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          ...record,
          tenantPk: tenantIndexPk(request.tenantId),
          expiresAt: auditExpiresAt(request.createdDate),
        },
        ConditionExpression: 'attribute_not_exists(pk)',
      }),
    );
  }

  async getRequest(id: string): Promise<AuditRequest | null> {
    const result = await ddb.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          pk: pk(id),
          sk: 'REQUEST',
        },
      }),
    );

    if (!result.Item) return null;
    const stored = result.Item as StoredAuditRecord;
    if (isExpired(stored)) return null;

    const {
      pk: _pk,
      sk: _sk,
      entityType: _entityType,
      tenantPk: _tenantPk,
      expiresAt: _expiresAt,
      ...request
    } = stored;
    return request as AuditRequest;
  }

  async updateStatus(params: {
    id: string;
    status: AuditStatus;
    updatedDate: string;
    completedDate?: string;
    errorMessage?: string;
  }): Promise<void> {
    const names: Record<string, string> = {
      '#status': 'status',
      '#updatedDate': 'updatedDate',
    };
    const values: Record<string, unknown> = {
      ':status': params.status,
      ':updatedDate': params.updatedDate,
    };
    const assignments = ['#status = :status', '#updatedDate = :updatedDate'];

    if (params.completedDate) {
      names['#completedDate'] = 'completedDate';
      values[':completedDate'] = params.completedDate;
      assignments.push('#completedDate = :completedDate');
    }

    if (params.errorMessage) {
      names['#errorMessage'] = 'errorMessage';
      values[':errorMessage'] = params.errorMessage;
      assignments.push('#errorMessage = :errorMessage');
    }

    await ddb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: {
          pk: pk(params.id),
          sk: 'REQUEST',
        },
        UpdateExpression: `SET ${assignments.join(', ')}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      }),
    );
  }

  async putResult(result: AuditResult): Promise<void> {
    const record: AuditRecord = {
      ...result,
      pk: pk(result.auditRequestId),
      sk: 'RESULT',
      entityType: 'AUDIT_RESULT',
    };

    await ddb.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          ...record,
          tenantPk: tenantIndexPk(result.tenantId),
          expiresAt: auditExpiresAt(result.createdDate),
        },
      }),
    );
  }

  async getResult(id: string): Promise<AuditResult | null> {
    const result = await ddb.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          pk: pk(id),
          sk: 'RESULT',
        },
      }),
    );

    if (!result.Item) return null;
    const stored = result.Item as StoredAuditRecord;
    if (isExpired(stored)) return null;

    const {
      pk: _pk,
      sk: _sk,
      entityType: _entityType,
      tenantPk: _tenantPk,
      expiresAt: _expiresAt,
      ...auditResult
    } = stored;
    return auditResult as AuditResult;
  }

  async listRequests(params: {
    tenantId: string;
    status?: AuditStatus;
    limit?: number;
  }): Promise<AuditRequest[]> {
    const result = await ddb.send(
      new ScanCommand({
        TableName: this.tableName,
        FilterExpression: params.status
          ? 'tenantPk = :tenantPk AND entityType = :entityType AND expiresAt > :now AND #status = :status'
          : 'tenantPk = :tenantPk AND entityType = :entityType AND expiresAt > :now',
        ExpressionAttributeNames: params.status ? { '#status': 'status' } : undefined,
        ExpressionAttributeValues: {
          ':tenantPk': tenantIndexPk(params.tenantId),
          ':entityType': 'AUDIT_REQUEST',
          ':now': nowEpochSeconds(),
          ...(params.status ? { ':status': params.status } : {}),
        },
        Limit: params.limit ?? 100,
      }),
    );

    return ((result.Items as StoredAuditRecord[] | undefined) ?? [])
      .filter((item) => item.tenantId === params.tenantId && !isExpired(item))
      .map(({
        pk: _pk,
        sk: _sk,
        entityType: _entityType,
        tenantPk: _tenantPk,
        expiresAt: _expiresAt,
        ...item
      }) => item as AuditRequest)
      .sort((a, b) => b.createdDate.localeCompare(a.createdDate));
  }
}
