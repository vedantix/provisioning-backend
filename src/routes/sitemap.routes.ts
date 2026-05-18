import { Router } from 'express';

const router = Router();

router.get('/sitemap.xml', (_req, res) => {
  res.type('application/xml');
  res.send('<?xml version="1.0" encoding="UTF-8"?><urlset></urlset>');
});

export default router;
