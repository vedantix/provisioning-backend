import { Router } from 'express';
import { randomUUID } from 'crypto';

const router = Router();

function slugify(value: string): string {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function requireInternalApiKey(req: any, res: any, next: any) {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization' });
  }

  const token = authHeader.replace('Bearer ', '');

  if (token !== process.env.BASE44_AUTOCREATE_API_KEY) {
    return res.status(403).json({ error: 'Invalid API key' });
  }

  next();
}

router.post(
  '/base44/create-app',
  requireInternalApiKey,
  async (req, res) => {
    try {
      const {
        customerId,
        companyName,
        domain,
        packageCode,
        niche,
        templateKey,
        appPrompt,
      } = req.body;

      const slug = slugify(companyName || domain);
      const appId = `app_${randomUUID()}`;

      const result = {
        appId,
        appName: companyName,
        editorUrl: `https://app.base44.com/apps/${appId}`,
        previewUrl: `https://preview.vedantix.nl/${slug}`,
      };

      console.info('[BASE44_WEBHOOK] created app', {
        customerId,
        appId,
      });

      return res.status(200).json(result);
    } catch (error) {
      console.error('[BASE44_WEBHOOK] failed', {
        message: error instanceof Error ? error.message : 'Unknown error',
      });

      return res.status(500).json({
        error: 'BASE44_CREATE_FAILED',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  },
);

export default router;