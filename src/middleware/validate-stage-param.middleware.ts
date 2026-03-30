import type { NextFunction, Request, Response } from 'express';
import { validateStageParam } from '../validation/deployments.validation';

export function validateStageParamMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  validateStageParam(req.params.stage);
  next();
}