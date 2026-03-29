import type { Request, Response } from 'express';
import { checkDomainAvailability } from '../services/domain/domain-check.service';
import { addDomainToDeployment } from '../services/domain/add-domain.service';

export async function checkDomainController(req: Request, res: Response) {
  const domain = String(req.body?.domain ?? '').trim();

  if (!domain) {
    return res.status(400).json({
      success: false,
      error: 'domain is required'
    });
  }

  const result = await checkDomainAvailability(domain);

  return res.status(200).json({
    success: true,
    result
  });
}

export async function addDomainController(req: Request, res: Response) {
  const customerId = String(req.body?.customerId ?? '').trim();
  const deploymentId = String(req.body?.deploymentId ?? '').trim();
  const domain = String(req.body?.domain ?? '').trim();

  if (!customerId || !deploymentId || !domain) {
    return res.status(400).json({
      success: false,
      error: 'customerId, deploymentId and domain are required'
    });
  }

  const result = await addDomainToDeployment({
    customerId,
    deploymentId,
    domain
  });

  if (!result.success) {
    return res.status(409).json(result);
  }

  return res.status(200).json(result);
}