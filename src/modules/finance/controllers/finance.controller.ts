import type { Request, Response } from 'express';
import Stripe from 'stripe';
import { FinanceService } from '../services/finance.service';

function getEmptyStripeSummary() {
  return {
    enabled: false,
    mrr: 0,
    activeSubscriptions: 0,
    paidInvoices: 0,
    openInvoices: 0,
    failedPayments: 0,
    monthlyRevenue: 0,
    outstandingRevenue: 0,
    recentInvoices: [],
  };
}

function getStripe(): Stripe | null {
  const secretKey = process.env.STRIPE_SECRET_KEY;

  if (!secretKey) {
    return null;
  }

  return new Stripe(secretKey, {
    apiVersion: '2025-08-27.basil',
  });
}

export class FinanceController {
  constructor(private readonly financeService = new FinanceService()) {}

  bootstrapCustomer = async (req: Request, res: Response): Promise<void> => {
    const result = await this.financeService.bootstrapCustomerFinance({
      tenantId: req.ctx.tenantId,
      customerId: req.body.customerId,
      companyName: req.body.companyName,
      packageCode: req.body.packageCode,
      extras: Array.isArray(req.body.extras) ? req.body.extras : [],
      monthlyRevenue: req.body.monthlyRevenue,
      monthlyInfraCost: req.body.monthlyInfraCost,
      oneTimeSetupCost: req.body.oneTimeSetupCost,
      stripeCustomerId: req.body.stripeCustomerId,
      stripeSubscriptionId: req.body.stripeSubscriptionId,
      subscriptionStatus: req.body.subscriptionStatus,
      paymentStatus: req.body.paymentStatus,
      isActive: req.body.isActive,
      customerStatus: req.body.customerStatus,
      websiteBuildStatus: req.body.websiteBuildStatus,
      deploymentStatus: req.body.deploymentStatus,
    });

    res.status(result ? 201 : 200).json({
      data: result,
      requestId: req.ctx.requestId,
    });
  };

  createExpense = async (req: Request, res: Response): Promise<void> => {
    const result = await this.financeService.createExpense({
      tenantId: req.ctx.tenantId,
      customerId: req.body.customerId,
      title: req.body.title,
      category: req.body.category,
      amount: Number(req.body.amount),
      expenseDate: req.body.expenseDate,
    });

    res.status(201).json({
      data: result,
      requestId: req.ctx.requestId,
    });
  };

  getOverview = async (req: Request, res: Response): Promise<void> => {
    const result = await this.financeService.getOverview(
      req.ctx.tenantId,
      req.query.range,
    );

    res.status(200).json({
      data: result,
      requestId: req.ctx.requestId,
    });
  };

  getStripeSummary = async (req: Request, res: Response): Promise<void> => {
    const stripe = getStripe();

    if (!stripe) {
      res.status(200).json({
        data: getEmptyStripeSummary(),
        requestId: req.ctx.requestId,
      });
      return;
    }

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
      (i) => i.status === 'uncollectible' || i.status === 'void',
    );

    const monthlyRevenue = paidInvoices.reduce(
      (sum, invoice) => sum + (invoice.amount_paid || 0),
      0,
    );

    const outstandingRevenue = openInvoices.reduce(
      (sum, invoice) => sum + (invoice.amount_due || 0),
      0,
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

    res.status(200).json({
      data: {
        enabled: true,
        mrr: mrr / 100,
        activeSubscriptions: subscriptions.data.length,
        paidInvoices: paidInvoices.length,
        openInvoices: openInvoices.length,
        failedPayments: failedInvoices.length,
        monthlyRevenue: monthlyRevenue / 100,
        outstandingRevenue: outstandingRevenue / 100,
        recentInvoices,
      },
      requestId: req.ctx.requestId,
    });
  };

  getCustomerDetails = async (req: Request, res: Response): Promise<void> => {
    const result = await this.financeService.getCustomerDetails(
      req.ctx.tenantId,
      String(req.params.customerId),
      req.query.range,
    );

    res.status(200).json({
      data: result,
      requestId: req.ctx.requestId,
    });
  };

  deleteCustomerFinance = async (req: Request, res: Response): Promise<void> => {
    const result = await this.financeService.deleteCustomerFinance({
      tenantId: req.ctx.tenantId,
      customerId: String(req.params.customerId || '').trim(),
    });

    res.status(200).json({
      data: result,
      requestId: req.ctx.requestId,
    });
  };

  deleteExpense = async (req: Request, res: Response): Promise<void> => {
    const result = await this.financeService.deleteExpense({
      tenantId: req.ctx.tenantId,
      expenseId: String(req.params.expenseId || '').trim(),
    });

    res.status(200).json({
      data: result,
      requestId: req.ctx.requestId,
    });
  };
}
