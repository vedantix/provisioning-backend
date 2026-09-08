import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TooManyRequestsError } from '../../src/errors/app-error';
import {
  createAuditRateLimitMiddleware,
  resetAuditRateLimitStateForTests,
} from '../../src/modules/online-growth-audit/middleware/audit-rate-limit.middleware';

function createRequest(ip: string): Request {
  return {
    method: 'POST',
    baseUrl: '/api/audit',
    headers: {
      'x-forwarded-for': ip,
    },
    socket: {
      remoteAddress: '10.0.0.1',
    },
  } as unknown as Request;
}

function createResponse(): Response {
  return {
    setHeader: vi.fn(),
  } as unknown as Response;
}

describe('audit rate limit middleware', () => {
  beforeEach(() => {
    resetAuditRateLimitStateForTests();
  });

  it('blocks the same client after the configured limit', () => {
    const middleware = createAuditRateLimitMiddleware({
      windowMs: 60_000,
      maxRequests: 1,
    });
    const response = createResponse();
    const firstNext = vi.fn() as unknown as NextFunction;
    const secondNext = vi.fn() as unknown as NextFunction;

    middleware(createRequest('203.0.113.10'), response, firstNext);
    middleware(createRequest('203.0.113.10'), response, secondNext);

    expect(firstNext).toHaveBeenCalledWith();
    expect(secondNext).toHaveBeenCalledTimes(1);
    const error = (secondNext as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(error).toBeInstanceOf(TooManyRequestsError);
    expect((response.setHeader as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      'Retry-After',
      expect.any(String),
    );
  });

  it('keeps separate client buckets for different forwarded addresses', () => {
    const middleware = createAuditRateLimitMiddleware({
      windowMs: 60_000,
      maxRequests: 1,
    });
    const firstNext = vi.fn() as unknown as NextFunction;
    const secondNext = vi.fn() as unknown as NextFunction;

    middleware(createRequest('203.0.113.10'), createResponse(), firstNext);
    middleware(createRequest('203.0.113.11'), createResponse(), secondNext);

    expect(firstNext).toHaveBeenCalledWith();
    expect(secondNext).toHaveBeenCalledWith();
  });

  it('applies a global burst cap across different clients', () => {
    const middleware = createAuditRateLimitMiddleware({
      windowMs: 60_000,
      maxRequests: 10,
      globalWindowMs: 60_000,
      globalMaxRequests: 1,
    });
    const firstNext = vi.fn() as unknown as NextFunction;
    const secondNext = vi.fn() as unknown as NextFunction;

    middleware(createRequest('203.0.113.10'), createResponse(), firstNext);
    middleware(createRequest('203.0.113.11'), createResponse(), secondNext);

    expect(firstNext).toHaveBeenCalledWith();
    expect(secondNext).toHaveBeenCalledTimes(1);
    const error = (secondNext as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(error).toBeInstanceOf(TooManyRequestsError);
  });

  it('uses the right-most forwarded address as the observed client hop', () => {
    const middleware = createAuditRateLimitMiddleware({
      windowMs: 60_000,
      maxRequests: 1,
    });
    const firstNext = vi.fn() as unknown as NextFunction;
    const secondNext = vi.fn() as unknown as NextFunction;

    middleware(createRequest('198.51.100.50, 203.0.113.25'), createResponse(), firstNext);
    middleware(createRequest('192.0.2.99, 203.0.113.25'), createResponse(), secondNext);

    expect(firstNext).toHaveBeenCalledWith();
    expect(secondNext).toHaveBeenCalledTimes(1);
    const error = (secondNext as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(error).toBeInstanceOf(TooManyRequestsError);
  });
});
