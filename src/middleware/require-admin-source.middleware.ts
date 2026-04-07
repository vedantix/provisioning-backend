import type { NextFunction, Request, Response } from 'express';

export function requireAdminSourceMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const source = req.ctx?.source;
  const actorId = req.ctx?.actorId;

  const allowedSources = new Set(['ADMIN_PANEL', 'SYSTEM']);

  if (!source || !allowedSources.has(source)) {
    res.status(403).json({
      error: 'Forbidden',
      message: 'Admin source required',
      requestId: req.ctx?.requestId,
    });
    return;
  }

  if (!actorId && source !== 'SYSTEM') {
    res.status(403).json({
      error: 'Forbidden',
      message: 'Actor context required for admin actions',
      requestId: req.ctx?.requestId,
    });
    return;
  }

  next();
}