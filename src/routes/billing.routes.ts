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
    const priceId = String(req.body?.priceId || getDefaultPriceId()).trim();
    const successUrl = String(req.body?.successUrl || getDefaultSuccessUrl()).trim();
    const cancelUrl = String(req.body?.cancelUrl || getDefaultCancelUrl()).trim();

    if (!customerId) {
      res.status(400).json({ error: 'Stripe customer ID is required' });
      return;
    }

    if (!priceId) {
      res.status(400).json({
        error: 'Stripe price ID is required. Set STRIPE_DEFAULT_PRICE_ID or send priceId.',
      });
      return;
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
    });

    res.json({
      success: true,
      sessionId: session.id,
      checkoutUrl: session.url,
      url: session.url,
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
