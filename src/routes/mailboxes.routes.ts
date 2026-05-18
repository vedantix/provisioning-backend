import { Router } from 'express';

const router = Router();

router.get('/', async (_req, res) => {
  res.json({ items: [] });
});

router.post('/', async (_req, res) => {
  res.json({ created: true });
});

router.post('/:mailboxId/suspend', async (_req, res) => {
  res.json({ suspended: true });
});

router.post('/:mailboxId/activate', async (_req, res) => {
  res.json({ activated: true });
});

router.delete('/:mailboxId', async (_req, res) => {
  res.json({ deleted: true });
});

export default router;
