import type { Request, Response, NextFunction } from "express";
import { env } from "../config/env";

export function apiKeyMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (req.method === "OPTIONS") {
    return next();
  }

  const apiKey = String(req.header("X-Api-Key") || "").trim();

  if (!apiKey || apiKey !== env.provisioningApiKey) {
    return res.status(401).json({
      error: "Unauthorized",
      message: "Invalid or missing X-Api-Key",
    });
  }

  return next();
}