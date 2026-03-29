import type { Request, Response } from 'express';
import { rollbackSite } from '../services/deployment/rollback.service';

export async function rollbackController(req: Request, res: Response) {
  const customerId = String(req.body?.customerId ?? '').trim();
  const deploymentId = String(req.body?.deploymentId ?? '').trim();
  const targetRef = String(req.body?.targetRef ?? '').trim();

  if (!customerId || !deploymentId || !targetRef) {
    return res.status(400).json({
      success: false,
      error: 'customerId, deploymentId and targetRef are required'
    });
  }

  const result = await rollbackSite({
    customerId,
    deploymentId,
    targetRef
  });

  if (!result.success) {
    return res.status(409).json(result);
  }

  return res.status(200).json(result);
}