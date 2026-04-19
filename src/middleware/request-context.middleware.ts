import type { Request, Response, NextFunction } from "express";

type RequestContext = {
  source: string;
  actorId: string;
  tenantId: string;
};

declare global {
  namespace Express {
    interface Request {
      ctx?: RequestContext;
    }
  }
}

export function requestContextMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
) {
  if (req.method === "OPTIONS") {
    req.ctx = {
      source: String(req.header("X-Source") || "").trim(),
      actorId: String(req.header("X-Actor-Id") || "").trim(),
      tenantId: String(req.header("X-Tenant-Id") || "default").trim() || "default",
    };
    return next();
  }

  req.ctx = {
    source: String(req.header("X-Source") || "").trim(),
    actorId: String(req.header("X-Actor-Id") || "").trim(),
    tenantId: String(req.header("X-Tenant-Id") || "default").trim() || "default",
  };

  return next();
}