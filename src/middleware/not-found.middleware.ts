import type { Request, Response } from 'express';

export function notFoundMiddleware(req: Request, res: Response) {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `Route not found: ${req.method} ${req.originalUrl}`,
    },
    requestId: req.ctx?.requestId,
  });
}