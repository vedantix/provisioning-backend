import type { Request, Response } from 'express';
import { PlatformHealthService } from '../services/system/platform-health.service';

export class SystemController {
  constructor(private readonly platformHealthService = new PlatformHealthService()) {}

  health = async (_req: Request, res: Response): Promise<void> => {
    res.status(200).json({
      data: {
        status: 'ok',
        service: 'provisioning-backend',
        timestamp: new Date().toISOString(),
      },
    });
  };

  readiness = async (_req: Request, res: Response): Promise<void> => {
    res.status(200).json({
      data: {
        status: 'ready',
        checks: {
          app: 'ok',
        },
        timestamp: new Date().toISOString(),
      },
    });
  };

  googleHealth = async (_req: Request, res: Response): Promise<void> => {
    const data = await this.platformHealthService.google();
    res.status(data.status === 'ok' ? 200 : 503).json({ data });
  };

  deploymentsHealth = async (_req: Request, res: Response): Promise<void> => {
    const data = await this.platformHealthService.deployments();
    res.status(200).json({ data });
  };

  queuesHealth = async (_req: Request, res: Response): Promise<void> => {
    const data = await this.platformHealthService.queues();
    res.status(200).json({ data });
  };

  provisioningHealth = async (_req: Request, res: Response): Promise<void> => {
    const data = await this.platformHealthService.provisioning();
    res.status(data.status === 'ok' ? 200 : 503).json({ data });
  };
}
