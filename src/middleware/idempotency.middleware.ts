import type { NextFunction, Request, Response } from 'express';

export type IdempotencyRequest = Request & {
  idempotencyKey?: string;
};

const IDEMPOTENCY_HEADER_NAMES = [
  'idempotency-key',
  'x-idempotency-key',
] as const;

function extractIdempotencyKey(req: Request): string | undefined {
  for (const headerName of IDEMPOTENCY_HEADER_NAMES) {
    const value = req.headers[headerName];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

export function idempotencyMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const mutableReq = req as IdempotencyRequest;
  mutableReq.idempotencyKey = extractIdempotencyKey(req);
  next();
}