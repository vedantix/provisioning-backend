import { Router } from 'express';
import Stripe from 'stripe';

const router = Router();

function getStripe(): Stripe {
  const secretKey = process.env.STRIPE_SECRET_KEY;

  if (!secretKey) {
    throw new Error('STRIPE_SECRET_KEY is not configured');
  }

  return new Stripe(secretKey, {
    apiVersion: '2025-04-30.basil',
  });
}

router.get('/health', (_req, res) => {
  res.json({
    enabled: Boolean(process.env.STRIPE_SECRET_KEY),
  });
});

router.post('/customers', async (req, res, next) => {
  try {
    const stripe = getStripe();
    const { email, name, customerId } = req.body;

    const customer = await stripe.customers.create({
      email,
      name,
      metadata: {
        customerId: customerId || '',
      },
    });

    res.json({
      success: true,
      stripeCustomerId: customer.id,
    });
  } catch (error) {
    next(error);
  }
});

router.post('/checkout-session', async (req, res, next) => {
  try {
    const stripe = getStripe();
    const { customerId, priceId, successUrl, cancelUrl } = req.body;

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
    });
  } catch (error) {
    next(error);
  }
});

router.post('/portal', async (req, res, next) => {
  try {
    const stripe = getStripe();
    const { customerId, returnUrl } = req.body;

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
