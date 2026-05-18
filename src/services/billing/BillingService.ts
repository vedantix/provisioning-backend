export class BillingService {
  async getSubscription() {
    return {
      status: 'ACTIVE',
      plan: 'PRO',
      billingCycle: 'monthly'
    };
  }

  async getInvoices() {
    return [];
  }

  async createCheckoutSession() {
    return {
      url: 'https://checkout.stripe.com'
    };
  }

  async createPortalSession() {
    return {
      url: 'https://billing.stripe.com'
    };
  }
}

export const billingService = new BillingService();
