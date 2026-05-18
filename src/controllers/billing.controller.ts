import { Request, Response } from 'express';
import { billingService } from '../services/billing/BillingService';

export async function getSubscription(_req: Request, res: Response) {
  const result = await billingService.getSubscription();
  res.json(result);
}

export async function getInvoices(_req: Request, res: Response) {
  const items = await billingService.getInvoices();
  res.json({ items });
}

export async function createCheckoutSession(_req: Request, res: Response) {
  const result = await billingService.createCheckoutSession();
  res.json(result);
}

export async function createPortalSession(_req: Request, res: Response) {
  const result = await billingService.createPortalSession();
  res.json(result);
}
