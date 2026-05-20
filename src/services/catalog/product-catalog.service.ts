import { ProductCatalogRepository } from '../../repositories/product-catalog.repository';
import { BadRequestError, NotFoundError } from '../../errors/app-error';
import { AppRunnerConfigService } from '../aws/app-runner-config.service';
import { StripeProductCatalogService } from './stripe-product-catalog.service';
import type {
  ProductCatalogInput,
  ProductCatalogRecord,
  ProductCatalogSyncResult,
} from '../../types/product-catalog.types';

function normalizeCode(code: string): string {
  return String(code || '').trim().toUpperCase();
}

function validateProductInput(input: ProductCatalogInput): ProductCatalogInput {
  const code = normalizeCode(input.code);
  const name = String(input.name || '').trim();
  const description = String(input.description || '').trim();
  const monthlyPrice = Number(input.monthlyPrice);
  const setupPrice = Number(input.setupPrice);

  if (!code) {
    throw new BadRequestError('Product code is verplicht.');
  }

  if (!/^[A-Z0-9_]+$/.test(code)) {
    throw new BadRequestError(
      'Product code mag alleen hoofdletters, cijfers en underscores bevatten.',
    );
  }

  if (!name) {
    throw new BadRequestError('Product naam is verplicht.');
  }

  if (Number.isNaN(monthlyPrice) || monthlyPrice < 0) {
    throw new BadRequestError('Monthly price moet 0 of hoger zijn.');
  }

  if (Number.isNaN(setupPrice) || setupPrice < 0) {
    throw new BadRequestError('Setup price moet 0 of hoger zijn.');
  }

  return {
    code,
    name,
    description,
    monthlyPrice,
    setupPrice,
  };
}

export function buildProductPriceEnvironmentVariables(
  product: Pick<
    ProductCatalogRecord,
    'code' | 'stripeMonthlyPriceId' | 'stripeSetupPriceId'
  >,
): Record<string, string> {
  return {
    [`STRIPE_PRICE_${product.code}`]: product.stripeMonthlyPriceId || '',
    [`STRIPE_PRICE_${product.code}_SETUP`]: product.stripeSetupPriceId || '',
  };
}

export class ProductCatalogService {
  constructor(
    private readonly repository = new ProductCatalogRepository(),
    private readonly stripeService = new StripeProductCatalogService(),
    private readonly appRunnerConfigService = new AppRunnerConfigService(),
  ) {}

  async listProducts(): Promise<ProductCatalogRecord[]> {
    return this.repository.listProducts();
  }

  async upsertProduct(input: ProductCatalogInput): Promise<ProductCatalogRecord> {
    const normalized = validateProductInput(input);
    const now = new Date().toISOString();
    const existing = await this.repository.getProduct(normalized.code);

    const record: ProductCatalogRecord = {
      ...existing,
      ...normalized,
      description: normalized.description || '',
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      stripeProductId: existing?.stripeProductId || '',
      stripeMonthlyPriceId: existing?.stripeMonthlyPriceId || '',
      stripeSetupPriceId: existing?.stripeSetupPriceId || '',
      lastSyncedAt: existing?.lastSyncedAt,
    };

    await this.repository.upsertProduct(record);
    return record;
  }

  async syncProduct(codeInput: string): Promise<ProductCatalogSyncResult> {
    const code = normalizeCode(codeInput);
    const existing = await this.repository.getProduct(code);

    if (!existing) {
      throw new NotFoundError(`Product niet gevonden: ${code}`);
    }

    const stripe = await this.stripeService.syncProduct(existing);
    const now = new Date().toISOString();
    const syncedProduct: ProductCatalogRecord = {
      ...existing,
      stripeProductId: stripe.productId,
      stripeMonthlyPriceId: stripe.monthlyPriceId,
      stripeSetupPriceId: stripe.setupPriceId,
      lastSyncedAt: now,
      updatedAt: now,
    };

    await this.repository.upsertProduct(syncedProduct);

    const environmentVariables =
      buildProductPriceEnvironmentVariables(syncedProduct);
    const appRunner = await this.appRunnerConfigService.syncEnvironmentVariables(
      environmentVariables,
    );

    return {
      product: syncedProduct,
      stripe,
      appRunner,
      environmentVariables,
    };
  }
}
