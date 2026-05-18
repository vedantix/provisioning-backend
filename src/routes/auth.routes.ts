import { Router } from 'express';

const router = Router();

router.post('/login', async (req, res) => {
  const { email } = req.body || {};

  res.json({
    success: true,
    email,
    message: 'Magic link sent.',
  });
});

router.get('/me', async (_req, res) => {
  res.json({
    authenticated: true,
    user: {
      id: 'user_1',
      email: 'info@vedantix.nl',
      role: 'ADMIN',
    },
  });
});

router.post('/logout', async (_req, res) => {
  res.json({ success: true });
});

export default router;
