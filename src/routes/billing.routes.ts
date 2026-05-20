import { Router } from 'express';
import Stripe from 'stripe';
import { requireAdminAuthMiddleware } from '../middleware/require-admin-auth.middleware';
import { requireActorContextMiddleware } from '../middleware/require-actor-context.middleware';

const router = Router();

function getStripe(): Stripe {
  const secretKey = process.env.STRIPE_SECRET_KEY;

  if (!secretKey) {
    throw new Error('STRIPE_SECRET_KEY is not configured');
  }

  return new Stripe(secretKey, {
    apiVersion: '2025-08-27.basil',
  });
}

function getDefaultPriceId(): string {
  return process.env.STRIPE_DEFAULT_PRICE_ID || process.env.STRIPE_PRICE_ID || '';
}

function getDefaultSuccessUrl(): string {
  return process.env.STRIPE_SUCCESS_URL || 'https://vedantix.nl/admin';
}

function getDefaultCancelUrl(): string {
  return process.env.STRIPE_CANCEL_URL || getDefaultSuccessUrl();
}

function getStripeCustomerId(body: any): string {
  return String(body?.stripeCustomerId || body?.customerId || '').trim();
}

function normalizePackageCode(value: unknown): string {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
}

function getPackagePrices(packageCode: string): { monthly?: string; setup?: string } {
  const packages: Record<string, { monthly?: string; setup?: string }> = {
    STARTER: {
      monthly: process.env.STRIPE_PRICE_STARTER,
      setup: process.env.STRIPE_PRICE_STARTER_SETUP,
    },
    GROWTH: {
      monthly: process.env.STRIPE_PRICE_GROWTH,
      setup: process.env.STRIPE_PRICE_GROWTH_SETUP,
    },
    PRO: {
      monthly: process.env.STRIPE_PRICE_PRO,
      setup: process.env.STRIPE_PRICE_PRO_SETUP,
    },
  };

  return packages[packageCode] || {};
}

router.get('/health', (_req, res) => {
  res.json({
    enabled: Boolean(process.env.STRIPE_SECRET_KEY),
  });
});

router.use(requireAdminAuthMiddleware);
router.use(requireActorContextMiddleware);

router.post('/customers', async (req, res, next) => {
  try {
    const stripe = getStripe();
    const { email, name, customerId, metadata } = req.body;

    const customer = await stripe.customers.create({
      email: email || undefined,
      name: name || undefined,
      metadata: {
        ...(metadata && typeof metadata === 'object' ? metadata : {}),
        customerId: customerId || metadata?.customerId || '',
      },
    });

    res.json({
      success: true,
      stripeCustomerId: customer.id,
      customer: {
        id: customer.id,
        email: customer.email,
        name: customer.name,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post('/checkout-session', async (req, res, next) => {
  try {
    const stripe = getStripe();
    const customerId = getStripeCustomerId(req.body);
    const packageCode = normalizePackageCode(
      req.body?.packageCode || req.body?.package || req.body?.planCode
    );

    const packagePrices = getPackagePrices(packageCode);

    const monthlyPriceId = String(
      req.body?.priceId || packagePrices.monthly || getDefaultPriceId()
    ).trim();

    const setupPriceId = String(
      req.body?.setupPriceId || packagePrices.setup || ''
    ).trim();

    const successUrl = String(req.body?.successUrl || getDefaultSuccessUrl()).trim();
    const cancelUrl = String(req.body?.cancelUrl || getDefaultCancelUrl()).trim();

    if (!customerId) {
      res.status(400).json({ error: 'Stripe customer ID is required' });
      return;
    }

    if (!monthlyPriceId) {
      res.status(400).json({
        error: 'Stripe monthly price ID is required.',
      });
      return;
    }

    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];

    if (setupPriceId) {
      lineItems.push({
        price: setupPriceId,
        quantity: 1,
      });
    }

    lineItems.push({
      price: monthlyPriceId,
      quantity: 1,
    });

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: lineItems,
      success_url: successUrl,
      cancel_url: cancelUrl,
    });

    res.json({
      success: true,
      sessionId: session.id,
      checkoutUrl: session.url,
      url: session.url,
      lineItems,
    });
  } catch (error) {
    next(error);
  }
});

router.post('/portal', async (req, res, next) => {
  try {
    const stripe = getStripe();
    const customerId = getStripeCustomerId(req.body);
    const returnUrl = String(req.body?.returnUrl || getDefaultSuccessUrl()).trim();

    if (!customerId) {
      res.status(400).json({ error: 'Stripe customer ID is required' });
      return;
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });

    res.json({
      success: true,
      url: session.url,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
