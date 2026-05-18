import { Router } from 'express';

const router = Router();

router.get('/dashboard', async (_req, res) => {
  res.json({
    mrr: 49,
    customers: 1,
    deployments: 1,
    activeMailboxes: 1,
  });
});

router.get('/customers', async (_req, res) => {
  res.json({ items: [] });
});

router.get('/deployments', async (_req, res) => {
  res.json({ items: [] });
});

export default router;
