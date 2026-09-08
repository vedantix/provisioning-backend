import crypto from 'node:crypto';
import net from 'node:net';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import type { NextFunction, Request, Response } from 'express';
import { TooManyRequestsError } from '../../../errors/app-error';

type AuditRateLimitOptions = {
  windowMs: number;
  maxRequests: number;
  globalWindowMs?: number;
  globalMaxRequests?: number;
  consumeRequest?: AuditRateLimitConsumer;
  now?: () => number;
};

type LimitDefinition = {
  windowMs: number;
  maxRequests: number;
};

export type AuditRateLimitConsumeInput = {
  clientFingerprint: string;
  method: string;
  path: string;
  now: number;
  client: LimitDefinition;
  global?: LimitDefinition;
};

export type AuditRateLimitConsumeResult = {
  allowed: boolean;
  resetAt: number;
  scope?: 'client' | 'global';
};

export type AuditRateLimitConsumer = (
  input: AuditRateLimitConsumeInput,
) => Promise<AuditRateLimitConsumeResult>;

type Bucket = {
  pk: string;
  sk: string;
  resetAt: number;
  expiresAt: number;
};

const RATE_LIMIT_TABLE =
  process.env.ONLINE_GROWTH_AUDITS_TABLE?.trim() ||
  'vedantix-online-growth-audits';
const RATE_LIMIT_TTL_GRACE_MS = 60 * 60 * 1_000;
const client = new DynamoDBClient({
  region: process.env.AWS_REGION?.trim() || 'eu-west-1',
});
const ddb = DynamoDBDocumentClient.from(client, {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});

function normalizeIp(value?: string | null): string | null {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;

  const withoutBrackets = trimmed.startsWith('[') && trimmed.includes(']')
    ? trimmed.slice(1, trimmed.indexOf(']'))
    : trimmed;

  if (net.isIP(withoutBrackets)) return withoutBrackets.toLowerCase();

  const lastColon = withoutBrackets.lastIndexOf(':');
  if (lastColon > 0) {
    const addressWithoutPort = withoutBrackets.slice(0, lastColon);
    const port = withoutBrackets.slice(lastColon + 1);
    if (/^\d+$/.test(port) && net.isIP(addressWithoutPort) === 4) {
      return addressWithoutPort.toLowerCase();
    }
  }

  return null;
}

function clientAddress(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  const forwardedValue = Array.isArray(forwarded) ? forwarded.join(',') : forwarded;
  const forwardedAddresses = String(forwardedValue || '')
    .split(',')
    .map((item) => normalizeIp(item))
    .filter((item): item is string => Boolean(item));

  // AWS's public HTTP proxy appends the directly observed client hop to
  // X-Forwarded-For. The right-most valid address therefore avoids trusting
  // arbitrary client-supplied values to the left.
  const proxiedClient = forwardedAddresses.length
    ? forwardedAddresses[forwardedAddresses.length - 1]
    : undefined;
  if (proxiedClient) return proxiedClient;

  return (
    normalizeIp(req.socket?.remoteAddress) ||
    normalizeIp(req.ip) ||
    'unknown-client'
  );
}

function fingerprintSecret(): string {
  const secret =
    process.env.AUDIT_RATE_LIMIT_HASH_SECRET?.trim() ||
    process.env.ADMIN_SESSION_SECRET?.trim() ||
    process.env.PROVISIONING_API_KEY?.trim();

  if (secret) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Audit rate-limit fingerprint secret is not configured.');
  }

  return 'vedantix-audit-rate-limit-development-key';
}

function clientFingerprint(req: Request): string {
  return crypto
    .createHmac('sha256', fingerprintSecret())
    .update(`audit-rate-limit:v1:${clientAddress(req)}`)
    .digest('hex');
}

function bucket(
  scope: 'client' | 'global',
  identity: string,
  windowMs: number,
  now: number,
): Bucket {
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const resetAt = windowStart + windowMs;
  const identityHash = crypto
    .createHash('sha256')
    .update(`${scope}:${identity}`)
    .digest('hex');

  return {
    pk: `RATE_LIMIT#${scope.toUpperCase()}#${identityHash}`,
    sk: `WINDOW#${windowStart}`,
    resetAt,
    expiresAt: Math.ceil((resetAt + RATE_LIMIT_TTL_GRACE_MS) / 1_000),
  };
}

function updateForBucket(target: Bucket, maxRequests: number) {
  return {
    Update: {
      TableName: RATE_LIMIT_TABLE,
      Key: {
        pk: target.pk,
        sk: target.sk,
      },
      UpdateExpression:
        'SET entityType = :entityType, expiresAt = :expiresAt, resetAt = :resetAt ADD #count :one',
      ConditionExpression: 'attribute_not_exists(#count) OR #count < :max',
      ExpressionAttributeNames: {
        '#count': 'count',
      },
      ExpressionAttributeValues: {
        ':entityType': 'AUDIT_RATE_LIMIT',
        ':expiresAt': target.expiresAt,
        ':resetAt': target.resetAt,
        ':one': 1,
        ':max': maxRequests,
      },
    },
  };
}

async function readCount(target: Bucket): Promise<number> {
  const result = await ddb.send(
    new GetCommand({
      TableName: RATE_LIMIT_TABLE,
      Key: {
        pk: target.pk,
        sk: target.sk,
      },
      ProjectionExpression: '#count',
      ExpressionAttributeNames: {
        '#count': 'count',
      },
      ConsistentRead: true,
    }),
  );

  return Number(result.Item?.count || 0);
}

function isTransactionCanceled(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: string }).name === 'TransactionCanceledException'
  );
}

async function consumeDistributedRequest(
  input: AuditRateLimitConsumeInput,
): Promise<AuditRateLimitConsumeResult> {
  const pathIdentity = `${input.method}:${input.path}`;
  const clientBucket = bucket(
    'client',
    `${input.clientFingerprint}:${pathIdentity}`,
    input.client.windowMs,
    input.now,
  );
  const globalBucket = input.global
    ? bucket('global', pathIdentity, input.global.windowMs, input.now)
    : null;

  const transactItems = [
    updateForBucket(clientBucket, input.client.maxRequests),
    ...(globalBucket && input.global
      ? [updateForBucket(globalBucket, input.global.maxRequests)]
      : []),
  ];

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await ddb.send(
        new TransactWriteCommand({
          TransactItems: transactItems,
        }),
      );

      return {
        allowed: true,
        resetAt: clientBucket.resetAt,
      };
    } catch (error) {
      if (!isTransactionCanceled(error)) throw error;

      const [clientCount, globalCount] = await Promise.all([
        readCount(clientBucket),
        globalBucket ? readCount(globalBucket) : Promise.resolve(0),
      ]);

      if (clientCount >= input.client.maxRequests) {
        return {
          allowed: false,
          scope: 'client',
          resetAt: clientBucket.resetAt,
        };
      }

      if (
        globalBucket &&
        input.global &&
        globalCount >= input.global.maxRequests
      ) {
        return {
          allowed: false,
          scope: 'global',
          resetAt: globalBucket.resetAt,
        };
      }

      // Concurrent writes can briefly conflict without either limit being
      // exhausted. Retry a couple of times before surfacing the infrastructure error.
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
        continue;
      }

      throw error;
    }
  }

  throw new Error('Audit rate-limit transaction could not be completed.');
}

export function createAuditRateLimitMiddleware(options: AuditRateLimitOptions) {
  if (options.windowMs <= 0 || options.maxRequests <= 0) {
    throw new Error('Audit rate limit windowMs and maxRequests must be positive.');
  }
  if (
    (options.globalWindowMs !== undefined && options.globalWindowMs <= 0) ||
    (options.globalMaxRequests !== undefined && options.globalMaxRequests <= 0)
  ) {
    throw new Error('Global audit rate limit values must be positive.');
  }
  if (
    (options.globalWindowMs === undefined) !==
    (options.globalMaxRequests === undefined)
  ) {
    throw new Error(
      'globalWindowMs and globalMaxRequests must be configured together.',
    );
  }

  const consumer = options.consumeRequest ?? consumeDistributedRequest;
  const now = options.now ?? Date.now;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const currentTime = now();
      const result = await consumer({
        clientFingerprint: clientFingerprint(req),
        method: req.method,
        path: req.baseUrl || '/api/audit',
        now: currentTime,
        client: {
          windowMs: options.windowMs,
          maxRequests: options.maxRequests,
        },
        ...(options.globalWindowMs && options.globalMaxRequests
          ? {
              global: {
                windowMs: options.globalWindowMs,
                maxRequests: options.globalMaxRequests,
              },
            }
          : {}),
      });

      if (result.allowed) {
        next();
        return;
      }

      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((result.resetAt - currentTime) / 1_000),
      );
      res.setHeader('Retry-After', String(retryAfterSeconds));

      next(
        new TooManyRequestsError(
          result.scope === 'global'
            ? 'De auditcapaciteit is tijdelijk volledig benut. Probeer het over enkele minuten opnieuw.'
            : 'Te veel audits vanaf dezelfde verbinding. Probeer het later opnieuw.',
          {
            retryAfterSeconds,
            scope: result.scope || 'client',
          },
        ),
      );
    } catch (error) {
      next(error);
    }
  };
}

// Kept for compatibility with older imports. The production limiter no longer
// has process-local state to clear.
export function resetAuditRateLimitStateForTests(): void {
  // no-op
}
