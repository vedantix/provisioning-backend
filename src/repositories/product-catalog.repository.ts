import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import { env } from '../config/env';
import type { ProductCatalogRecord } from '../types/product-catalog.types';

const client = new DynamoDBClient({ region: env.awsRegion });
const ddb = DynamoDBDocumentClient.from(client);

export class ProductCatalogRepository {
  constructor(private readonly tableName = env.productCatalogTable) {}

  async listProducts(): Promise<ProductCatalogRecord[]> {
    const items: ProductCatalogRecord[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;

    do {
      const result = await ddb.send(
        new ScanCommand({
          TableName: this.tableName,
          ExclusiveStartKey: exclusiveStartKey,
        }),
      );

      items.push(...((result.Items as ProductCatalogRecord[] | undefined) ?? []));
      exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey);

    return items.sort((a, b) => String(a.code).localeCompare(String(b.code)));
  }

  async getProduct(code: string): Promise<ProductCatalogRecord | null> {
    const result = await ddb.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          code,
        },
      }),
    );

    return (result.Item as ProductCatalogRecord | undefined) ?? null;
  }

  async upsertProduct(product: ProductCatalogRecord): Promise<void> {
    await ddb.send(
      new PutCommand({
        TableName: this.tableName,
        Item: product,
      }),
    );
  }
}
