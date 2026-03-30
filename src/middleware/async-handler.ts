import type { NextFunction, Request, Response } from 'express';

type AsyncRouteHandler<TReq extends Request = Request> = (
  req: TReq,
  res: Response,
  next: NextFunction,
) => Promise<unknown>;

export function asyncHandler<TReq extends Request = Request>(
  fn: AsyncRouteHandler<TReq>,
) {
  return (req: TReq, res: Response, next: NextFunction) => {
    void Promise.resolve(fn(req, res, next)).catch(next);
  };
}