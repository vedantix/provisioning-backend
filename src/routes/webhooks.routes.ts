import { Router } from 'express';

const router = Router();

router.post('/stripe', async (_req, res) => {
  res.json({ received: true });
});

router.post('/base44', async (_req, res) => {
  res.json({ received: true });
});

export default router;
