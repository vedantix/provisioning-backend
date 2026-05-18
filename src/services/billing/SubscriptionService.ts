export class SubscriptionService {
  async getCurrentSubscription(customerId: string) {
    return {
      customerId,
      status: 'ACTIVE',
      plan: 'PRO',
      billingCycle: 'monthly',
      cancelAtPeriodEnd: false,
    };
  }
}

export const subscriptionService = new SubscriptionService();
