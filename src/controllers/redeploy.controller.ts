import type { Request, Response } from 'express';
import { redeploySite } from '../services/deployment/redeploy.service';

export async function redeployController(req: Request, res: Response) {
  const customerId = String(req.body?.customerId ?? '').trim();
  const deploymentId = String(req.body?.deploymentId ?? '').trim();

  if (!customerId || !deploymentId) {
    return res.status(400).json({
      success: false,
      error: 'customerId and deploymentId are required'
    });
  }

  const result = await redeploySite({
    customerId,
    deploymentId
  });

  if (!result.success) {
    return res.status(409).json(result);
  }

  return res.status(200).json(result);
}