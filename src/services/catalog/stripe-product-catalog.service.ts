import Stripe from 'stripe';
import { env } from '../../config/env';
import type { ProductCatalogRecord } from '../../types/product-catalog.types';

type StripeProductSyncResult = {
  productId: string;
  monthlyPriceId: string;
  setupPriceId: string;
};

function getStripe(): Stripe {
  const secretKey = process.env.STRIPE_SECRET_KEY;

  if (!secretKey) {
    throw new Error('STRIPE_SECRET_KEY is not configured');
  }

  return new Stripe(secretKey, {
    apiVersion: '2025-08-27.basil',
  });
}

function toStripeAmount(amount: number): number {
  return Math.round(Number(amount || 0) * 100);
}

export class StripeProductCatalogService {
  constructor(private readonly stripeClient?: Stripe) {}

  async syncProduct(product: ProductCatalogRecord): Promise<StripeProductSyncResult> {
    const stripe = this.getStripe();
    const stripeProduct = await this.findOrCreateProduct(product);

    if (
      stripeProduct.name !== product.name ||
      stripeProduct.description !== product.description
    ) {
      await stripe.products.update(stripeProduct.id, {
        name: product.name,
        description: product.description || undefined,
        metadata: {
          ...(stripeProduct.metadata || {}),
          code: product.code,
        },
      });
    }

    const [monthlyPrice, setupPrice] = await Promise.all([
      stripe.prices.create({
        currency: env.stripeCurrency,
        unit_amount: toStripeAmount(product.monthlyPrice),
        product: stripeProduct.id,
        recurring: {
          interval: 'month',
        },
        metadata: {
          code: product.code,
          kind: 'MONTHLY',
        },
      }),
      stripe.prices.create({
        currency: env.stripeCurrency,
        unit_amount: toStripeAmount(product.setupPrice),
        product: stripeProduct.id,
        metadata: {
          code: product.code,
          kind: 'SETUP',
        },
      }),
    ]);

    return {
      productId: stripeProduct.id,
      monthlyPriceId: monthlyPrice.id,
      setupPriceId: setupPrice.id,
    };
  }

  private async findOrCreateProduct(
    product: ProductCatalogRecord,
  ): Promise<Stripe.Product> {
    const existing = await this.findProductByCode(product.code);

    if (existing) {
      return existing;
    }

    return this.getStripe().products.create({
      name: product.name,
      description: product.description || undefined,
      metadata: {
        code: product.code,
      },
    });
  }

  private async findProductByCode(code: string): Promise<Stripe.Product | null> {
    const stripe = this.getStripe();
    let startingAfter: string | undefined;

    do {
      const page = await stripe.products.list({
        active: true,
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });

      const match = page.data.find((item) => item.metadata?.code === code);
      if (match) {
        return match;
      }

      startingAfter = page.has_more
        ? page.data[page.data.length - 1]?.id
        : undefined;
    } while (startingAfter);

    return null;
  }

  private getStripe(): Stripe {
    return this.stripeClient || getStripe();
  }
}
