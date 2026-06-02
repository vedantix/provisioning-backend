import {
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
} from '@aws-sdk/client-dynamodb';
import {
  BatchWriteCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { env } from '../../../config/env';
import type {
  MigrationBaseRecord,
  MigrationImageRecord,
  MigrationPageRecord,
  MigrationRecord,
  MigrationReportRecord,
} from '../types/migration.types';

const client = new DynamoDBClient({ region: env.awsRegion });
const ddb = DynamoDBDocumentClient.from(client);
const ensuredTables = new Map<string, Promise<void>>();

export function migrationPk(tenantId: string): string {
  return `TENANT#${tenantId}`;
}

export function migrationSk(migrationId: string): string {
  return `MIGRATION#${migrationId}`;
}

export function migrationChildSk(
  migrationId: string,
  type: 'PAGE' | 'IMAGE' | 'REPORT',
  id: string,
): string {
  return `MIGRATION#${migrationId}#${type}#${id}`;
}

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

function removeUndefinedValues<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .filter((item) => item !== undefined)
      .map((item) => removeUndefinedValues(item)) as T;
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, removeUndefinedValues(item)]),
    ) as T;
  }

  return value;
}

export class MigrationRepository {
  constructor(private readonly tableName = env.migrationsTable) {}

  async putMigration(record: MigrationRecord): Promise<MigrationRecord> {
    await this.ensureTableExists();
    const clean = removeUndefinedValues(record);
    await ddb.send(
      new PutCommand({
        TableName: this.tableName,
        Item: clean,
      }),
    );
    return clean;
  }

  async getMigration(
    tenantId: string,
    migrationId: string,
  ): Promise<MigrationRecord | null> {
    await this.ensureTableExists();
    const result = await ddb.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          pk: migrationPk(tenantId),
          sk: migrationSk(migrationId),
        },
      }),
    );

    return (result.Item as MigrationRecord | undefined) ?? null;
  }

  async listMigrations(tenantId: string, limit = 100): Promise<MigrationRecord[]> {
    await this.ensureTableExists();
    const result = await ddb.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
        ExpressionAttributeValues: {
          ':pk': migrationPk(tenantId),
          ':prefix': 'MIGRATION#',
        },
        Limit: limit,
        ScanIndexForward: false,
      }),
    );

    return ((result.Items ?? []) as MigrationRecord[])
      .filter((item) => item.entityType === 'MIGRATION' && !item.deletedAt)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  async putPages(pages: MigrationPageRecord[]): Promise<void> {
    await this.batchPut(pages);
  }

  async putImages(images: MigrationImageRecord[]): Promise<void> {
    await this.batchPut(images);
  }

  async putReport(report: MigrationReportRecord): Promise<MigrationReportRecord> {
    await this.ensureTableExists();
    const clean = removeUndefinedValues(report);
    await ddb.send(
      new PutCommand({
        TableName: this.tableName,
        Item: clean,
      }),
    );
    return clean;
  }

  async getReport(
    tenantId: string,
    migrationId: string,
    reportId: string,
  ): Promise<MigrationReportRecord | null> {
    await this.ensureTableExists();
    const result = await ddb.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          pk: migrationPk(tenantId),
          sk: migrationChildSk(migrationId, 'REPORT', reportId),
        },
      }),
    );

    return (result.Item as MigrationReportRecord | undefined) ?? null;
  }

  async listPages(
    tenantId: string,
    migrationId: string,
  ): Promise<MigrationPageRecord[]> {
    return this.listChildren<MigrationPageRecord>(tenantId, migrationId, 'PAGE');
  }

  async listImages(
    tenantId: string,
    migrationId: string,
  ): Promise<MigrationImageRecord[]> {
    return this.listChildren<MigrationImageRecord>(tenantId, migrationId, 'IMAGE');
  }

  async replaceAnalysis(params: {
    tenantId: string;
    migrationId: string;
    pages: MigrationPageRecord[];
    images: MigrationImageRecord[];
  }): Promise<void> {
    const existingPages = await this.listPages(params.tenantId, params.migrationId);
    const existingImages = await this.listImages(params.tenantId, params.migrationId);
    await this.batchDelete([...existingPages, ...existingImages]);
    await this.putPages(params.pages);
    await this.putImages(params.images);
  }

  private async listChildren<T extends MigrationBaseRecord>(
    tenantId: string,
    migrationId: string,
    type: 'PAGE' | 'IMAGE',
  ): Promise<T[]> {
    await this.ensureTableExists();
    const result = await ddb.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
        ExpressionAttributeValues: {
          ':pk': migrationPk(tenantId),
          ':prefix': `MIGRATION#${migrationId}#${type}#`,
        },
      }),
    );

    return ((result.Items ?? []) as T[]).filter((item) => !item.deletedAt);
  }

  private async batchPut(records: MigrationBaseRecord[]): Promise<void> {
    if (records.length === 0) return;
    await this.ensureTableExists();

    for (let i = 0; i < records.length; i += 25) {
      const chunk = records.slice(i, i + 25).map((record) => ({
        PutRequest: {
          Item: removeUndefinedValues(record),
        },
      }));

      await ddb.send(
        new BatchWriteCommand({
          RequestItems: {
            [this.tableName]: chunk,
          },
        }),
      );
    }
  }

  private async batchDelete(records: MigrationBaseRecord[]): Promise<void> {
    if (records.length === 0) return;
    await this.ensureTableExists();

    for (let i = 0; i < records.length; i += 25) {
      const chunk = records.slice(i, i + 25).map((record) => ({
        DeleteRequest: {
          Key: {
            pk: record.pk,
            sk: record.sk,
          },
        },
      }));

      await ddb.send(
        new BatchWriteCommand({
          RequestItems: {
            [this.tableName]: chunk,
          },
        }),
      );
    }
  }

  async deleteMigration(tenantId: string, migrationId: string): Promise<void> {
    const migration = await this.getMigration(tenantId, migrationId);
    if (!migration) return;
    const pages = await this.listPages(tenantId, migrationId);
    const images = await this.listImages(tenantId, migrationId);
    await this.batchDelete([...pages, ...images]);
    await ddb.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { pk: migration.pk, sk: migration.sk },
      }),
    );
  }

  private async ensureTableExists(): Promise<void> {
    const existing = ensuredTables.get(this.tableName);
    if (existing) return existing;

    const promise = this.createTableIfMissing();
    ensuredTables.set(this.tableName, promise);

    try {
      await promise;
    } catch (error) {
      ensuredTables.delete(this.tableName);
      throw error;
    }
  }

  private async createTableIfMissing(): Promise<void> {
    try {
      const result = await client.send(
        new DescribeTableCommand({
          TableName: this.tableName,
        }),
      );

      const status = result.Table?.TableStatus;
      if (status === 'ACTIVE') return;

      for (let attempt = 0; attempt < 20; attempt += 1) {
        await sleep(1000);
        const next = await client.send(
          new DescribeTableCommand({ TableName: this.tableName }),
        );
        if (next.Table?.TableStatus === 'ACTIVE') return;
      }
      return;
    } catch (error) {
      if (!isResourceNotFound(error)) throw error;
    }

    try {
      await client.send(
        new CreateTableCommand({
          TableName: this.tableName,
          BillingMode: 'PAY_PER_REQUEST',
          AttributeDefinitions: [
            { AttributeName: 'pk', AttributeType: 'S' },
            { AttributeName: 'sk', AttributeType: 'S' },
          ],
          KeySchema: [
            { AttributeName: 'pk', KeyType: 'HASH' },
            { AttributeName: 'sk', KeyType: 'RANGE' },
          ],
        }),
      );
    } catch (error) {
      if (!isResourceInUse(error)) throw error;
    }

    for (let attempt = 0; attempt < 30; attempt += 1) {
      await sleep(1000);
      const result = await client.send(
        new DescribeTableCommand({ TableName: this.tableName }),
      );
      if (result.Table?.TableStatus === 'ACTIVE') return;
    }
  }
}
