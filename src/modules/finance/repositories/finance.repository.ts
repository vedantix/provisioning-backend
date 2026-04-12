import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import { env } from '../../../../src/config/env';
import type {
  CustomerFinanceRecord,
  FinanceExpenseRecord,
} from '../types/finance.types';

const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client);
const TABLE_NAME = env.financeTable;

type FinanceTableItem =
  | (CustomerFinanceRecord & {
      pk: string;
      sk: string;
      gsi1pk: string;
      gsi1sk: string;
      entityType: 'CUSTOMER_FINANCE';
    })
  | (FinanceExpenseRecord & {
      pk: string;
      sk: string;
      gsi1pk: string;
      gsi1sk: string;
      entityType: 'FINANCE_EXPENSE';
    });

export class FinanceRepository {
  async upsertCustomerFinance(record: CustomerFinanceRecord): Promise<void> {
    const item: FinanceTableItem = {
      ...record,
      pk: `TENANT#${record.tenantId}`,
      sk: `CUSTOMER#${record.customerId}`,
      gsi1pk: `CUSTOMER#${record.customerId}`,
      gsi1sk: `PROFILE#${record.updatedAt}`,
      entityType: 'CUSTOMER_FINANCE',
    };

    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: item,
      }),
    );
  }

  async getCustomerFinance(
    tenantId: string,
    customerId: string,
  ): Promise<CustomerFinanceRecord | null> {
    const result = await ddb.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: `TENANT#${tenantId}`,
          sk: `CUSTOMER#${customerId}`,
        },
      }),
    );

    return (result.Item as CustomerFinanceRecord | undefined) ?? null;
  }

  async listCustomerFinances(tenantId: string): Promise<CustomerFinanceRecord[]> {
    const result = await ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
        ExpressionAttributeValues: {
          ':pk': `TENANT#${tenantId}`,
          ':skPrefix': 'CUSTOMER#',
        },
      }),
    );

    return ((result.Items as CustomerFinanceRecord[] | undefined) ?? []).filter(
      (item) => (item as any).entityType === 'CUSTOMER_FINANCE',
    );
  }

  async createExpense(record: FinanceExpenseRecord): Promise<void> {
    const item: FinanceTableItem = {
      ...record,
      pk: `TENANT#${record.tenantId}`,
      sk: `EXPENSE#${record.expenseDate}#${record.id}`,
      gsi1pk: record.customerId
        ? `CUSTOMER#${record.customerId}`
        : 'CUSTOMER#UNASSIGNED',
      gsi1sk: `EXPENSE#${record.expenseDate}#${record.id}`,
      entityType: 'FINANCE_EXPENSE',
    };

    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: item,
      }),
    );
  }

  async listExpenses(tenantId: string): Promise<FinanceExpenseRecord[]> {
    const result = await ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
        ExpressionAttributeValues: {
          ':pk': `TENANT#${tenantId}`,
          ':skPrefix': 'EXPENSE#',
        },
      }),
    );

    return ((result.Items as FinanceExpenseRecord[] | undefined) ?? []).filter(
      (item) => (item as any).entityType === 'FINANCE_EXPENSE',
    );
  }

  async listExpensesByCustomer(
    customerId: string,
  ): Promise<FinanceExpenseRecord[]> {
    const result = await ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'gsi1',
        KeyConditionExpression: 'gsi1pk = :gsi1pk AND begins_with(gsi1sk, :prefix)',
        ExpressionAttributeValues: {
          ':gsi1pk': `CUSTOMER#${customerId}`,
          ':prefix': 'EXPENSE#',
        },
      }),
    );

    return ((result.Items as FinanceExpenseRecord[] | undefined) ?? []).filter(
      (item) => (item as any).entityType === 'FINANCE_EXPENSE',
    );
  }

  async healthScan(limit = 5): Promise<number> {
    const result = await ddb.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        Limit: limit,
        Select: 'COUNT',
      }),
    );

    return result.Count ?? 0;
  }
}