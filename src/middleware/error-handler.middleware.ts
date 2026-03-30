import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app-error';

export function errorHandlerMiddleware(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  const requestId = req.ctx?.requestId;

  if (error instanceof AppError) {
    console.error({
      level: 'error',
      requestId,
      code: error.code,
      message: error.message,
      details: error.details,
    });

    res.status(error.statusCode).json({
      error: {
        code: error.code,
        message: error.message,
        details: error.details ?? null,
      },
      requestId,
    });
    return;
  }

  const message = error instanceof Error ? error.message : 'Internal server error';

  console.error({
    level: 'error',
    requestId,
    code: 'INTERNAL_ERROR',
    message,
  });

  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    },
    requestId,
  });
}