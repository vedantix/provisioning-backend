import type { Request, Response } from 'express';
import { addMailboxToDeployment } from '../services/mailbox/mailbox.service';

export async function addMailboxController(req: Request, res: Response) {
  const customerId = String(req.body?.customerId ?? '').trim();
  const deploymentId = String(req.body?.deploymentId ?? '').trim();
  const domain = String(req.body?.domain ?? '').trim();
  const mailboxLocalPart = String(req.body?.mailboxLocalPart ?? '').trim();
  const quantity =
    req.body?.quantity === undefined ? 1 : Number(req.body.quantity);

  if (!customerId || !deploymentId || !domain || !mailboxLocalPart) {
    return res.status(400).json({
      success: false,
      error: 'customerId, deploymentId, domain and mailboxLocalPart are required'
    });
  }

  const result = await addMailboxToDeployment({
    customerId,
    deploymentId,
    domain,
    mailboxLocalPart,
    quantity
  });

  if (!result.success) {
    return res.status(409).json(result);
  }

  return res.status(200).json(result);
}