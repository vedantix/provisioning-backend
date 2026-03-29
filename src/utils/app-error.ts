import type { DeploymentStage } from "../services/types/deployment.types";

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly stage?: DeploymentStage;
  public readonly details?: Record<string, unknown>;
  public readonly expose: boolean;

  constructor(params: {
    message: string;
    code: string;
    statusCode?: number;
    stage?: DeploymentStage;
    details?: Record<string, unknown>;
    expose?: boolean;
  }) {
    super(params.message);
    this.name = "AppError";
    this.statusCode = params.statusCode ?? 500;
    this.code = params.code;
    this.stage = params.stage;
    this.details = params.details;
    this.expose = params.expose ?? true;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}