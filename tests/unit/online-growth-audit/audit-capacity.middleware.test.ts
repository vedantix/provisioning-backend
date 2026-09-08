import type { NextFunction, Request, Response } from 'express';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { TooManyRequestsError } from '../../../src/errors/app-error';

process.env.NODE_ENV = 'test';
process.env.AWS_REGION = 'eu-west-1';
process.env.AWS_ACM_REGION = 'us-east-1';
process.env.AWS_ROUTE53_HOSTED_ZONE_ID = 'ZTEST';
process.env.GITHUB_OWNER = 'vedantix';
process.env.GITHUB_TOKEN = 'test-token';
process.env.PROVISIONING_API_KEY = 'test-api-key';
process.env.SQS_QUEUE_URL = 'https://sqs.eu-west-1.amazonaws.com/123456789012/test';
process.env.CUSTOMERS_TABLE = 'test-customers';
process.env.DEPLOYMENTS_TABLE = 'test-deployments';
process.env.JOBS_TABLE = 'test-jobs';

type CreateAuditCapacityMiddleware =
  typeof import('../../../src/modules/online-growth-audit/middleware/audit-capacity.middleware').createAuditCapacityMiddleware;

let createAuditCapacityMiddleware: CreateAuditCapacityMiddleware;

beforeAll(async () => {
  ({ createAuditCapacityMiddleware } = await import(
    '../../../src/modules/online-growth-audit/middleware/audit-capacity.middleware'
  ));
});

describe('createAuditCapacityMiddleware', () => {
  it('allows an audit when capacity is available', async () => {
    const next = vi.fn();
    const middleware = createAuditCapacityMiddleware({
      maxActiveAudits: 20,
      countActiveAudits: async () => 19,
    });

    await middleware({} as Request, {} as Response, next as unknown as NextFunction);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
  });

  it('returns a 429 error when the active audit cap is reached', async () => {
    const next = vi.fn();
    const middleware = createAuditCapacityMiddleware({
      maxActiveAudits: 20,
      countActiveAudits: async () => 20,
    });

    await middleware({} as Request, {} as Response, next as unknown as NextFunction);

    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0][0] as TooManyRequestsError;
    expect(error).toBeInstanceOf(TooManyRequestsError);
    expect(error.statusCode).toBe(429);
    expect(error.details).toMatchObject({
      activeAudits: 20,
      maxActiveAudits: 20,
    });
  });

  it('propagates capacity lookup failures', async () => {
    const next = vi.fn();
    const lookupError = new Error('DynamoDB unavailable');
    const middleware = createAuditCapacityMiddleware({
      maxActiveAudits: 20,
      countActiveAudits: async () => {
        throw lookupError;
      },
    });

    await middleware({} as Request, {} as Response, next as unknown as NextFunction);

    expect(next).toHaveBeenCalledWith(lookupError);
  });

  it('rejects invalid capacity configuration immediately', () => {
    expect(() =>
      createAuditCapacityMiddleware({
        maxActiveAudits: 0,
        countActiveAudits: async () => 0,
      }),
    ).toThrow('maxActiveAudits must be a positive integer.');
  });
});
