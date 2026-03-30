import type { NextFunction, Request, Response } from 'express';
import { validateCreateDeploymentBody } from '../validation/deployments.validation';

export function validateCreateDeploymentMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  validateCreateDeploymentBody(req.body);
  next();
}