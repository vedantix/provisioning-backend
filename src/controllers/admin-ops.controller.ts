import type { Request, Response } from 'express';
import { CleanupCandidatesService } from '../domain/deployments/cleanup-candidates.service';

export class AdminOpsController {
  constructor(
    private readonly cleanupCandidatesService = new CleanupCandidatesService(),
  ) {}

  listCleanupCandidates = async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    const limitRaw = req.query.limit;
    const limit =
      typeof limitRaw === 'string' ? Number.parseInt(limitRaw, 10) : 50;

    const candidates = await this.cleanupCandidatesService.listCandidates({
      tenantId: req.ctx.tenantId,
      limit: Number.isFinite(limit) ? limit : 50,
    });

    res.status(200).json({
      data: {
        items: candidates,
        count: candidates.length,
      },
      requestId: req.ctx.requestId,
    });
  };
}