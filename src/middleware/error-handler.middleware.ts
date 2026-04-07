import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app-error';

export function errorHandlerMiddleware(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  const requestId = req.ctx?.requestId;
  const isProd = process.env.NODE_ENV === 'production';

  if (error instanceof AppError) {
    console.error({
      level: 'error',
      requestId,
      code: error.code,
      message: error.message,
      details: error.details,
      stack: error.stack,
    });

    res.status(error.statusCode).json({
      error: {
        code: error.code,
        message: error.message,
        details: error.details ?? null,
        stack: isProd ? undefined : error.stack,
      },
      requestId,
    });
    return;
  }

  const message = error instanceof Error ? error.message : 'Internal server error';
  const stack = error instanceof Error ? error.stack : undefined;

  console.error({
    level: 'error',
    requestId,
    code: 'INTERNAL_ERROR',
    message,
    stack,
    raw: error,
  });

  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message,
      stack: isProd ? undefined : stack,
    },
    requestId,
  });
}