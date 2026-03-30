import type { Request, Response } from 'express';

export class SystemController {
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
}