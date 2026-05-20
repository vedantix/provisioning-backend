import { Router } from 'express';
import Stripe from 'stripe';

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

router.get('/summary', async (_req, res, next) => {
  try {
    const stripe = getStripe();

    const [subscriptions, invoices] = await Promise.all([
      stripe.subscriptions.list({ status: 'active', limit: 100 }),
      stripe.invoices.list({ limit: 100 }),
    ]);

    const mrr = subscriptions.data.reduce((total, subscription) => {
      const amount = subscription.items.data.reduce((sum, item) => {
        return sum + (item.price.unit_amount || 0) * (item.quantity || 1);
      }, 0);

      return total + amount;
    }, 0);

    const paidInvoices = invoices.data.filter((i) => i.status === 'paid');
    const openInvoices = invoices.data.filter((i) => i.status === 'open');
    const failedInvoices = invoices.data.filter(
      (i) => i.status === 'uncollectible' || i.status === 'void'
    );

    const monthlyRevenue = paidInvoices.reduce(
      (sum, invoice) => sum + (invoice.amount_paid || 0),
      0
    );

    const outstandingRevenue = openInvoices.reduce(
      (sum, invoice) => sum + (invoice.amount_due || 0),
      0
    );

    const recentInvoices = invoices.data.slice(0, 10).map((invoice) => ({
      id: invoice.id,
      number: invoice.number,
      customerName:
        typeof invoice.customer_name === 'string'
          ? invoice.customer_name
          : invoice.customer_email || 'Onbekend',
      status: invoice.status,
      amountPaid: (invoice.amount_paid || 0) / 100,
      amountDue: (invoice.amount_due || 0) / 100,
      currency: invoice.currency,
      hostedInvoiceUrl: invoice.hosted_invoice_url,
      invoicePdf: invoice.invoice_pdf,
      created: invoice.created,
    }));

    res.json({
      mrr: mrr / 100,
      activeSubscriptions: subscriptions.data.length,
      paidInvoices: paidInvoices.length,
      openInvoices: openInvoices.length,
      failedPayments: failedInvoices.length,
      monthlyRevenue: monthlyRevenue / 100,
      outstandingRevenue: outstandingRevenue / 100,
      recentInvoices,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
