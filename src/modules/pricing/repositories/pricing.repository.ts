import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { env } from "../../../../src/config/env";
import type { PricingAddonRecord, PricingPackageRecord } from "../types/pricing.types";
import { DEFAULT_ADDONS, DEFAULT_PACKAGES } from "../config/pricing.defaults";

const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client);
const TABLE_NAME = env.pricingTable;

export class PricingRepository {
  async ensureSeeded(): Promise<void> {
    const existingPackages = await this.listPackages();
    if (existingPackages.length === 0) {
      for (const item of DEFAULT_PACKAGES) {
        await this.upsertPackage(item);
      }
    }

    const existingAddons = await this.listAddons();
    if (existingAddons.length === 0) {
      for (const item of DEFAULT_ADDONS) {
        await this.upsertAddon(item);
      }
    }
  }

  async listPackages(): Promise<PricingPackageRecord[]> {
    const result = await ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :skPrefix)",
        ExpressionAttributeValues: {
          ":pk": "PRICING",
          ":skPrefix": "PACKAGE#",
        },
      })
    );

    return ((result.Items as PricingPackageRecord[] | undefined) ?? []).sort(
      (a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0)
    );
  }

  async listAddons(): Promise<PricingAddonRecord[]> {
    const result = await ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :skPrefix)",
        ExpressionAttributeValues: {
          ":pk": "PRICING",
          ":skPrefix": "ADDON#",
        },
      })
    );

    return ((result.Items as PricingAddonRecord[] | undefined) ?? []).sort(
      (a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0)
    );
  }

  async getPackage(code: string): Promise<PricingPackageRecord | null> {
    const result = await ddb.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: "PRICING",
          sk: `PACKAGE#${code}`,
        },
      })
    );

    return (result.Item as PricingPackageRecord | undefined) ?? null;
  }

  async getAddon(code: string): Promise<PricingAddonRecord | null> {
    const result = await ddb.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: "PRICING",
          sk: `ADDON#${code}`,
        },
      })
    );

    return (result.Item as PricingAddonRecord | undefined) ?? null;
  }

  async upsertPackage(item: PricingPackageRecord): Promise<void> {
    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          ...item,
          pk: "PRICING",
          sk: `PACKAGE#${item.code}`,
        },
      })
    );
  }

  async upsertAddon(item: PricingAddonRecord): Promise<void> {
    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          ...item,
          pk: "PRICING",
          sk: `ADDON#${item.code}`,
        },
      })
    );
  }
}