import { Router } from 'express';

const router = Router();

router.get('/subscription', async (_req, res) => {
  res.json({ status: 'ACTIVE' });
});

router.get('/invoices', async (_req, res) => {
  res.json({ items: [] });
});

router.post('/checkout', async (_req, res) => {
  res.json({ url: 'https://checkout.stripe.com' });
});

router.post('/portal', async (_req, res) => {
  res.json({ url: 'https://billing.stripe.com' });
});

export default router;
