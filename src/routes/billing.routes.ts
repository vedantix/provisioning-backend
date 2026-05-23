import { Router } from 'express';
import Stripe from 'stripe';
import { requireAdminAuthMiddleware } from '../middleware/require-admin-auth.middleware';
import { requireActorContextMiddleware } from '../middleware/require-actor-context.middleware';
import { CustomersRepository } from '../modules/customers/repositories/customers.repository';
import type { CustomerRecord } from '../modules/customers/types/customer.types';

const router = Router();
const customersRepository = new CustomersRepository();

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

function isLiveCustomer(customer?: CustomerRecord | null): boolean {
  return Boolean(
    customer?.status === 'active' ||
      customer?.websiteBuildStatus === 'LIVE' ||
      customer?.deployment?.status === 'SUCCEEDED',
  );
}

async function assertInvoiceAllowed(req: any): Promise<void> {
  const internalCustomerId = String(
    req.body?.internalCustomerId || req.body?.customerRecordId || '',
  ).trim();

  if (!internalCustomerId) {
    return;
  }

  const customer = await customersRepository.getById(internalCustomerId);
  const tenantId = String(req.ctx?.tenantId || 'default');

  if (!customer || customer.tenantId !== tenantId) {
    const error = new Error('Customer not found');
    (error as any).statusCode = 404;
    throw error;
  }

  if (!isLiveCustomer(customer)) {
    const error = new Error('De eerste maand mag pas worden gefactureerd nadat de website live staat.');
    (error as any).statusCode = 409;
    throw error;
  }
}

async function getPriceAmount(
  stripe: Stripe,
  priceId: string,
): Promise<{ amount: number; currency: string } | null> {
  if (!priceId) return null;

  const price = await stripe.prices.retrieve(priceId);
  const amount = Number(price.unit_amount || 0);
  const currency = String(price.currency || 'eur').toLowerCase();

  if (!amount || amount < 0) {
    return null;
  }

  return { amount, currency };
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

router.post('/first-invoice', async (req, res, next) => {
  try {
    await assertInvoiceAllowed(req);

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
    const daysUntilDue = Number(req.body?.daysUntilDue || 14);

    if (!customerId) {
      res.status(400).json({ error: 'Stripe customer ID is required' });
      return;
    }

    if (!monthlyPriceId) {
      res.status(400).json({ error: 'Stripe monthly price ID is required.' });
      return;
    }

    const monthlyPrice = await getPriceAmount(stripe, monthlyPriceId);
    if (!monthlyPrice) {
      res.status(400).json({ error: 'Stripe monthly price has no invoiceable amount.' });
      return;
    }

    const setupPrice = await getPriceAmount(stripe, setupPriceId);
    const invoiceItems: Stripe.InvoiceItem[] = [];

    if (setupPrice?.amount) {
      invoiceItems.push(
        await stripe.invoiceItems.create({
          customer: customerId,
          amount: setupPrice.amount,
          currency: setupPrice.currency,
          description: `Setup ${packageCode || 'website'}`,
        }),
      );
    }

    invoiceItems.push(
      await stripe.invoiceItems.create({
        customer: customerId,
        amount: monthlyPrice.amount,
        currency: monthlyPrice.currency,
        description: `Eerste maand ${packageCode || 'website'}`,
      }),
    );

    const invoice = await stripe.invoices.create({
      customer: customerId,
      collection_method: 'send_invoice',
      days_until_due: Number.isFinite(daysUntilDue) ? daysUntilDue : 14,
      auto_advance: false,
      metadata: {
        internalCustomerId: String(req.body?.internalCustomerId || ''),
        packageCode,
        invoiceType: 'FIRST_MONTH',
      },
    });

    if (!invoice.id) {
      res.status(500).json({ error: 'Stripe invoice ID ontbreekt.' });
      return;
    }

    const finalized = await stripe.invoices.finalizeInvoice(invoice.id);
    if (!finalized.id) {
      res.status(500).json({ error: 'Stripe finalized invoice ID ontbreekt.' });
      return;
    }

    const sent = await stripe.invoices.sendInvoice(finalized.id);

    res.json({
      success: true,
      invoiceId: sent.id,
      number: sent.number,
      status: sent.status,
      hostedInvoiceUrl: sent.hosted_invoice_url,
      invoicePdf: sent.invoice_pdf,
      invoiceItems: invoiceItems.map((item) => ({
        id: item.id,
        amount: item.amount,
        currency: item.currency,
        description: item.description,
      })),
    });
  } catch (error) {
    const statusCode = Number((error as any)?.statusCode || 0);
    if (statusCode) {
      res.status(statusCode).json({
        error: error instanceof Error ? error.message : 'Invoice could not be sent',
      });
      return;
    }

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
