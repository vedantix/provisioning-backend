import type { Request, Response } from 'express';
import { deleteEverything } from '../services/delete/delete-everything.service';

export async function deleteEverythingController(req: Request, res: Response) {
  const customerId = String(req.body?.customerId ?? '').trim();
  const deploymentId = String(req.body?.deploymentId ?? '').trim();
  const confirm = req.body?.confirm === true;

  if (!customerId || !deploymentId) {
    return res.status(400).json({
      success: false,
      error: 'customerId and deploymentId are required'
    });
  }

  const result = await deleteEverything({
    customerId,
    deploymentId,
    confirm
  });

  if (!result.success) {
    return res.status(409).json(result);
  }

  return res.status(200).json(result);
}