import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env';

export function apiKeyMiddleware(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.header('x-api-key');

  if (!apiKey || apiKey !== env.provisioningApiKey) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  next();
}