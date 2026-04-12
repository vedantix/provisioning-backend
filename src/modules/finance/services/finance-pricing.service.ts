export class FinancePricingService {
    private readonly packagePricing: Record<string, number> = {
      STARTER: 99,
      GROWTH: 149,
      PRO: 249,
      CUSTOM: 399,
    };
  
    private readonly extraPricing: Record<string, number> = {
      BLOG: 15,
      BOOKING: 25,
      ANALYTICS: 10,
      CRM: 25,
      FORMS: 12,
      SEO_PLUS: 20,
      EXTRA_MAILBOX: 7,
      PRIORITY_SUPPORT: 35,
    };
  
    getMonthlyRevenue(packageCode: string, extras: string[] = []): number {
      const packageRevenue = this.packagePricing[packageCode] ?? 0;
      const extrasRevenue = extras.reduce(
        (sum, item) => sum + (this.extraPricing[item] ?? 0),
        0,
      );
  
      return packageRevenue + extrasRevenue;
    }
  
    getMultiplier(range: string): number {
      switch (range) {
        case 'day':
          return 1 / 30;
        case 'week':
          return 7 / 30;
        case 'month':
          return 1;
        case 'quarter':
          return 3;
        case 'halfyear':
          return 6;
        case 'year':
          return 12;
        default:
          return 1;
      }
    }
  }