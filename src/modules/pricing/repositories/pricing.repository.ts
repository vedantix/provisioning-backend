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

function normalizeTenantId(tenantId?: string): string {
  return String(tenantId || "default").trim() || "default";
}

function pricingPk(tenantId?: string): string {
  return `TENANT#${normalizeTenantId(tenantId)}#PRICING`;
}

function legacyPricingPk(): string {
  return "PRICING";
}

export class PricingRepository {
  async ensureSeeded(tenantId?: string): Promise<void> {
    const existingPackages = await this.listPackages(tenantId);
    if (existingPackages.length === 0) {
      for (const item of DEFAULT_PACKAGES) {
        await this.upsertPackage(item, tenantId);
      }
    }

    const existingAddons = await this.listAddons(tenantId);
    if (existingAddons.length === 0) {
      for (const item of DEFAULT_ADDONS) {
        await this.upsertAddon(item, tenantId);
      }
    }
  }

  async listPackages(tenantId?: string): Promise<PricingPackageRecord[]> {
    const tenantPk = pricingPk(tenantId);

    const result = await ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :skPrefix)",
        ExpressionAttributeValues: {
          ":pk": tenantPk,
          ":skPrefix": "PACKAGE#",
        },
      })
    );

    const tenantItems = ((result.Items as PricingPackageRecord[] | undefined) ?? []).sort(
      (a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0)
    );

    if (tenantItems.length > 0) {
      return tenantItems;
    }

    const legacyResult = await ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :skPrefix)",
        ExpressionAttributeValues: {
          ":pk": legacyPricingPk(),
          ":skPrefix": "PACKAGE#",
        },
      })
    );

    return ((legacyResult.Items as PricingPackageRecord[] | undefined) ?? []).sort(
      (a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0)
    );
  }

  async listAddons(tenantId?: string): Promise<PricingAddonRecord[]> {
    const tenantPk = pricingPk(tenantId);

    const result = await ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :skPrefix)",
        ExpressionAttributeValues: {
          ":pk": tenantPk,
          ":skPrefix": "ADDON#",
        },
      })
    );

    const tenantItems = ((result.Items as PricingAddonRecord[] | undefined) ?? []).sort(
      (a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0)
    );

    if (tenantItems.length > 0) {
      return tenantItems;
    }

    const legacyResult = await ddb.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :skPrefix)",
        ExpressionAttributeValues: {
          ":pk": legacyPricingPk(),
          ":skPrefix": "ADDON#",
        },
      })
    );

    return ((legacyResult.Items as PricingAddonRecord[] | undefined) ?? []).sort(
      (a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0)
    );
  }

  async getPackage(code: string, tenantId?: string): Promise<PricingPackageRecord | null> {
    const tenantResult = await ddb.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: pricingPk(tenantId),
          sk: `PACKAGE#${code}`,
        },
      })
    );

    if (tenantResult.Item) {
      return tenantResult.Item as PricingPackageRecord;
    }

    const legacyResult = await ddb.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: legacyPricingPk(),
          sk: `PACKAGE#${code}`,
        },
      })
    );

    return (legacyResult.Item as PricingPackageRecord | undefined) ?? null;
  }

  async getAddon(code: string, tenantId?: string): Promise<PricingAddonRecord | null> {
    const tenantResult = await ddb.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: pricingPk(tenantId),
          sk: `ADDON#${code}`,
        },
      })
    );

    if (tenantResult.Item) {
      return tenantResult.Item as PricingAddonRecord;
    }

    const legacyResult = await ddb.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: legacyPricingPk(),
          sk: `ADDON#${code}`,
        },
      })
    );

    return (legacyResult.Item as PricingAddonRecord | undefined) ?? null;
  }

  async upsertPackage(item: PricingPackageRecord, tenantId?: string): Promise<void> {
    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          ...item,
          pk: pricingPk(tenantId),
          sk: `PACKAGE#${item.code}`,
          tenantId: normalizeTenantId(tenantId),
          entityType: "PRICING_PACKAGE",
        },
      })
    );
  }

  async upsertAddon(item: PricingAddonRecord, tenantId?: string): Promise<void> {
    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          ...item,
          pk: pricingPk(tenantId),
          sk: `ADDON#${item.code}`,
          tenantId: normalizeTenantId(tenantId),
          entityType: "PRICING_ADDON",
        },
      })
    );
  }
}