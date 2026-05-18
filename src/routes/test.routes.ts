import { Router } from 'express';

const router = Router();

router.get('/ping', (_req, res) => {
  res.json({ pong: true });
});

router.get('/smoke', (_req, res) => {
  res.json({ ok: true });
});

export default router;
