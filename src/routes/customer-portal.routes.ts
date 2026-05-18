import { Router } from 'express';

const router = Router();

router.get('/me', async (_req, res) => {
  res.json({
    id: 'customer_1',
    companyName: 'Vedantix Customer',
    status: 'ACTIVE',
  });
});

router.get('/dashboard', async (_req, res) => {
  res.json({
    activeSites: 1,
    activeMailboxes: 1,
    subscriptionStatus: 'ACTIVE',
  });
});

router.get('/subscription', async (_req, res) => {
  res.json({
    plan: 'PRO',
    status: 'ACTIVE',
    billingCycle: 'monthly',
  });
});

router.get('/invoices', async (_req, res) => {
  res.json({ items: [] });
});

export default router;
