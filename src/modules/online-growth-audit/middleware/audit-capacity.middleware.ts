import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import type { NextFunction, Request, Response } from 'express';
import { env } from '../../../config/env';
import { TooManyRequestsError } from '../../../errors/app-error';

const DEFAULT_MAX_ACTIVE_AUDITS = 20;
const ACTIVE_AUDIT_STALE_AFTER_MS = 60 * 60 * 1_000;

const client = new DynamoDBClient({ region: env.awsRegion });
const ddb = DynamoDBDocumentClient.from(client);

type AuditCapacityOptions = {
  maxActiveAudits?: number;
  countActiveAudits?: () => Promise<number>;
};

async function countActiveAudits(): Promise<number> {
  const now = Date.now();
  const staleCutoff = new Date(now - ACTIVE_AUDIT_STALE_AFTER_MS).toISOString();

  const result = await ddb.send(
    new ScanCommand({
      TableName: env.onlineGrowthAuditsTable,
      Select: 'COUNT',
      FilterExpression:
        'entityType = :entityType AND (#status = :pending OR #status = :running) AND updatedDate >= :staleCutoff AND expiresAt > :now',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':entityType': 'AUDIT_REQUEST',
        ':pending': 'PENDING',
        ':running': 'RUNNING',
        ':staleCutoff': staleCutoff,
        ':now': Math.floor(now / 1_000),
      },
    }),
  );

  return result.Count ?? 0;
}

export function createAuditCapacityMiddleware(options: AuditCapacityOptions = {}) {
  const maxActiveAudits = options.maxActiveAudits ?? DEFAULT_MAX_ACTIVE_AUDITS;
  const activeCounter = options.countActiveAudits ?? countActiveAudits;

  if (!Number.isInteger(maxActiveAudits) || maxActiveAudits <= 0) {
    throw new Error('maxActiveAudits must be a positive integer.');
  }

  return async (_req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const activeAudits = await activeCounter();
      if (activeAudits >= maxActiveAudits) {
        next(
          new TooManyRequestsError(
            'De auditcapaciteit is tijdelijk volledig benut. Probeer het later opnieuw.',
            {
              activeAudits,
              maxActiveAudits,
            },
          ),
        );
        return;
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}
