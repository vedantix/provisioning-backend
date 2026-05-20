import { Router } from 'express';
import Stripe from 'stripe';

const router = Router();

type CatalogProduct = {
  code: string;
  name: string;
  description?: string;
  monthlyPrice: number;
  setupPrice: number;
  stripeProductId?: string;
  stripeMonthlyPriceId?: string;
  stripeSetupPriceId?: string;
  updatedAt: string;
};

const catalog = new Map<string, CatalogProduct>();

function getStripe(): Stripe {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) throw new Error('STRIPE_SECRET_KEY is not configured');
  return new Stripe(secretKey, { apiVersion: '2025-08-27.basil' });
}

function normalizeCode(code: string): string {
  return String(code || '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
}

async function ensurePrice(
  stripe: Stripe,
  productId: string,
  amount: number,
  recurring: boolean
): Promise<string> {
  const price = await stripe.prices.create({
    product: productId,
    unit_amount: Math.round(amount * 100),
    currency: 'eur',
    ...(recurring ? { recurring: { interval: 'month' } } : {}),
  });

  return price.id;
}

router.get('/products', (_req, res) => {
  res.json(Array.from(catalog.values()));
});

router.post('/products', async (req, res, next) => {
  try {
    const code = normalizeCode(req.body.code);
    const product: CatalogProduct = {
      code,
      name: req.body.name,
      description: req.body.description || '',
      monthlyPrice: Number(req.body.monthlyPrice || 0),
      setupPrice: Number(req.body.setupPrice || 0),
      updatedAt: new Date().toISOString(),
    };

    catalog.set(code, { ...catalog.get(code), ...product });
    res.json(catalog.get(code));
  } catch (error) {
    next(error);
  }
});

router.post('/products/:code/sync', async (req, res, next) => {
  try {
    const code = normalizeCode(req.params.code);
    const product = catalog.get(code);

    if (!product) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }

    const stripe = getStripe();

    let stripeProductId = product.stripeProductId;

    if (!stripeProductId) {
      const stripeProduct = await stripe.products.create({
        name: product.name,
        description: product.description,
        metadata: { code },
      });
      stripeProductId = stripeProduct.id;
    }

    const stripeMonthlyPriceId = await ensurePrice(
      stripe,
      stripeProductId,
      product.monthlyPrice,
      true
    );

    const stripeSetupPriceId = await ensurePrice(
      stripe,
      stripeProductId,
      product.setupPrice,
      false
    );

    const synced: CatalogProduct = {
      ...product,
      stripeProductId,
      stripeMonthlyPriceId,
      stripeSetupPriceId,
      updatedAt: new Date().toISOString(),
    };

    catalog.set(code, synced);

    res.json({
      ...synced,
      env: {
        [`STRIPE_PRICE_${code}`]: stripeMonthlyPriceId,
        [`STRIPE_PRICE_${code}_SETUP`]: stripeSetupPriceId,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
