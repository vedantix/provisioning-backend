import type { Request, Response, NextFunction } from "express";

export function requireActorContextMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (req.method === "OPTIONS") {
    return next();
  }

  const source = String((req as any).ctx?.source || req.header("X-Source") || "").trim();
  const actorId = String((req as any).ctx?.actorId || req.header("X-Actor-Id") || "").trim();

  if (source === "SYSTEM") {
    return next();
  }

  if (!actorId) {
    return res.status(401).json({
      error: "Missing actor context",
      message: "X-Actor-Id is required",
    });
  }

  return next();
}