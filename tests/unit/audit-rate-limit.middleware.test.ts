import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { TooManyRequestsError } from '../../src/errors/app-error';
import {
  createAuditRateLimitMiddleware,
  type AuditRateLimitConsumeInput,
  type AuditRateLimitConsumeResult,
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

function createMemoryConsumer() {
  const counts = new Map<string, number>();

  return vi.fn(
    async (
      input: AuditRateLimitConsumeInput,
    ): Promise<AuditRateLimitConsumeResult> => {
      const clientWindow = Math.floor(input.now / input.client.windowMs);
      const clientKey = `client:${input.clientFingerprint}:${input.method}:${input.path}:${clientWindow}`;
      const clientResetAt = (clientWindow + 1) * input.client.windowMs;
      const clientCount = counts.get(clientKey) || 0;

      if (clientCount >= input.client.maxRequests) {
        return {
          allowed: false,
          scope: 'client',
          resetAt: clientResetAt,
        };
      }

      let globalKey = '';
      let globalResetAt = clientResetAt;
      if (input.global) {
        const globalWindow = Math.floor(input.now / input.global.windowMs);
        globalKey = `global:${input.method}:${input.path}:${globalWindow}`;
        globalResetAt = (globalWindow + 1) * input.global.windowMs;
        const globalCount = counts.get(globalKey) || 0;
        if (globalCount >= input.global.maxRequests) {
          return {
            allowed: false,
            scope: 'global',
            resetAt: globalResetAt,
          };
        }
      }

      counts.set(clientKey, clientCount + 1);
      if (globalKey) counts.set(globalKey, (counts.get(globalKey) || 0) + 1);

      return {
        allowed: true,
        resetAt: clientResetAt,
      };
    },
  );
}

const FIXED_NOW = 1_800_000;

function createMiddleware(options?: {
  maxRequests?: number;
  globalMaxRequests?: number;
}) {
  const consumeRequest = createMemoryConsumer();
  const middleware = createAuditRateLimitMiddleware({
    windowMs: 60_000,
    maxRequests: options?.maxRequests ?? 1,
    ...(options?.globalMaxRequests
      ? {
          globalWindowMs: 60_000,
          globalMaxRequests: options.globalMaxRequests,
        }
      : {}),
    consumeRequest,
    now: () => FIXED_NOW,
  });

  return { middleware, consumeRequest };
}

describe('audit rate limit middleware', () => {
  it('blocks the same client after the configured limit', async () => {
    const { middleware } = createMiddleware();
    const response = createResponse();
    const firstNext = vi.fn() as unknown as NextFunction;
    const secondNext = vi.fn() as unknown as NextFunction;

    await middleware(createRequest('203.0.113.10'), response, firstNext);
    await middleware(createRequest('203.0.113.10'), response, secondNext);

    expect(firstNext).toHaveBeenCalledWith();
    expect(secondNext).toHaveBeenCalledTimes(1);
    const error = (secondNext as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(error).toBeInstanceOf(TooManyRequestsError);
    expect((response.setHeader as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      'Retry-After',
      expect.any(String),
    );
  });

  it('keeps separate client buckets for different forwarded addresses', async () => {
    const { middleware } = createMiddleware();
    const firstNext = vi.fn() as unknown as NextFunction;
    const secondNext = vi.fn() as unknown as NextFunction;

    await middleware(createRequest('203.0.113.10'), createResponse(), firstNext);
    await middleware(createRequest('203.0.113.11'), createResponse(), secondNext);

    expect(firstNext).toHaveBeenCalledWith();
    expect(secondNext).toHaveBeenCalledWith();
  });

  it('applies a global burst cap across different clients', async () => {
    const { middleware } = createMiddleware({
      maxRequests: 10,
      globalMaxRequests: 1,
    });
    const firstNext = vi.fn() as unknown as NextFunction;
    const secondNext = vi.fn() as unknown as NextFunction;

    await middleware(createRequest('203.0.113.10'), createResponse(), firstNext);
    await middleware(createRequest('203.0.113.11'), createResponse(), secondNext);

    expect(firstNext).toHaveBeenCalledWith();
    expect(secondNext).toHaveBeenCalledTimes(1);
    const error = (secondNext as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(error).toBeInstanceOf(TooManyRequestsError);
  });

  it('uses the right-most forwarded address as the observed client hop', async () => {
    const { middleware } = createMiddleware();
    const firstNext = vi.fn() as unknown as NextFunction;
    const secondNext = vi.fn() as unknown as NextFunction;

    await middleware(
      createRequest('198.51.100.50, 203.0.113.25'),
      createResponse(),
      firstNext,
    );
    await middleware(
      createRequest('192.0.2.99, 203.0.113.25'),
      createResponse(),
      secondNext,
    );

    expect(firstNext).toHaveBeenCalledWith();
    expect(secondNext).toHaveBeenCalledTimes(1);
    const error = (secondNext as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(error).toBeInstanceOf(TooManyRequestsError);
  });

  it('passes only a pseudonymous client fingerprint to the shared store', async () => {
    const { middleware, consumeRequest } = createMiddleware();
    const next = vi.fn() as unknown as NextFunction;
    const rawIp = '203.0.113.42';

    await middleware(createRequest(rawIp), createResponse(), next);

    const input = consumeRequest.mock.calls[0][0];
    expect(input.clientFingerprint).not.toContain(rawIp);
    expect(input.clientFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(next).toHaveBeenCalledWith();
  });
});
