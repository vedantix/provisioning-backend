import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

let ProductCatalogService: typeof import('../../../src/services/catalog/product-catalog.service').ProductCatalogService;

function stubRequiredEnv() {
  vi.stubEnv('AWS_REGION', 'eu-west-1');
  vi.stubEnv('AWS_ACM_REGION', 'us-east-1');
  vi.stubEnv('AWS_ROUTE53_HOSTED_ZONE_ID', 'ZTEST');
  vi.stubEnv('GITHUB_OWNER', 'vedantix');
  vi.stubEnv('GITHUB_TOKEN', 'test-token');
  vi.stubEnv('PROVISIONING_API_KEY', 'test-api-key');
  vi.stubEnv('SQS_QUEUE_URL', 'https://sqs.eu-west-1.amazonaws.com/123/test');
  vi.stubEnv('CUSTOMERS_TABLE', 'vedantix-customers-test');
  vi.stubEnv('DEPLOYMENTS_TABLE', 'vedantix-deployments-test');
  vi.stubEnv('JOBS_TABLE', 'vedantix-jobs-test');
}

function buildPricingPackage(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pkg_starter',
    code: 'STARTER',
    label: 'Starter',
    slug: 'starter',
    description: 'Voor starters',
    monthlyPriceInclVat: 99,
    monthlyPriceExclVat: 81.82,
    monthlyVatAmount: 17.18,
    setupPriceInclVat: 599,
    setupPriceExclVat: 495.04,
    setupVatAmount: 103.96,
    monthlyInfraCostExclVat: 8,
    monthlyInfraCostVatAmount: 1.68,
    monthlyInfraCostInclVat: 9.68,
    vatRate: 0.21,
    featured: false,
    isActive: true,
    sortOrder: 1,
    fit: 'Voor starters',
    cancelNote: '',
    cta: '',
    bullets: [],
    included: [],
    notIncluded: [],
    addons: [],
    createdAt: '2026-05-20T00:00:00.000Z',
    updatedAt: '2026-05-20T00:00:00.000Z',
    ...overrides,
  };
}

beforeAll(async () => {
  stubRequiredEnv();
  ({ ProductCatalogService } = await import(
    '../../../src/services/catalog/product-catalog.service'
  ));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ProductCatalogService', () => {
  it('falls back to pricing packages when the catalog table cannot be read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const repository = {
      listProducts: vi.fn().mockRejectedValue(new Error('DynamoDB unavailable')),
    };
    const pricingService = {
      getSummary: vi.fn().mockResolvedValue({
        packages: [buildPricingPackage()],
      }),
    };

    const service = new ProductCatalogService(
      repository as any,
      {} as any,
      {} as any,
      pricingService as any,
    );

    await expect(service.listProducts('default')).resolves.toMatchObject([
      {
        code: 'STARTER',
        name: 'Vedantix Starter',
        description: 'Voor starters',
        monthlyPrice: 99,
        setupPrice: 599,
      },
    ]);
    expect(pricingService.getSummary).toHaveBeenCalledWith('default');
  });

  it('does not fail saving when the catalog table is missing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const repository = {
      getProduct: vi.fn().mockRejectedValue(new Error('Requested resource not found')),
      upsertProduct: vi.fn().mockRejectedValue(new Error('Requested resource not found')),
    };

    const service = new ProductCatalogService(
      repository as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(
      service.upsertProduct({
        code: 'CUSTOM',
        name: 'Vedantix Custom',
        description: 'Maatwerk',
        monthlyPrice: 599,
        setupPrice: 3999,
      }),
    ).resolves.toMatchObject({
      code: 'CUSTOM',
      name: 'Vedantix Custom',
      monthlyPrice: 599,
      setupPrice: 3999,
    });
  });

  it('can sync a product that only exists in pricing configuration', async () => {
    const repository = {
      getProduct: vi.fn().mockResolvedValue(null),
      upsertProduct: vi.fn().mockResolvedValue(undefined),
    };
    const stripeService = {
      syncProduct: vi.fn().mockResolvedValue({
        productId: 'prod_starter',
        monthlyPriceId: 'price_starter_month',
        setupPriceId: 'price_starter_setup',
      }),
    };
    const appRunnerConfigService = {
      syncEnvironmentVariables: vi.fn().mockResolvedValue({
        serviceArn: 'arn:aws:apprunner:eu-west-1:123:service/test',
        updateOperationId: 'op_update',
        deploymentOperationId: 'op_deploy',
        redeployStarted: true,
      }),
    };
    const pricingService = {
      getSummary: vi.fn().mockResolvedValue({
        packages: [buildPricingPackage()],
      }),
    };

    const service = new ProductCatalogService(
      repository as any,
      stripeService as any,
      appRunnerConfigService as any,
      pricingService as any,
    );

    const result = await service.syncProduct('starter', 'default');

    expect(repository.upsertProduct).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'STARTER', name: 'Vedantix Starter' }),
    );
    expect(result.product).toMatchObject({
      code: 'STARTER',
      stripeProductId: 'prod_starter',
      stripeMonthlyPriceId: 'price_starter_month',
      stripeSetupPriceId: 'price_starter_setup',
    });
    expect(result.environmentVariables).toEqual({
      STRIPE_PRICE_STARTER: 'price_starter_month',
      STRIPE_PRICE_STARTER_SETUP: 'price_starter_setup',
    });
  });

  it('returns Stripe IDs with warnings when storage or App Runner sync fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const repository = {
      getProduct: vi.fn().mockRejectedValue(new Error('catalog unavailable')),
      upsertProduct: vi.fn().mockRejectedValue(new Error('catalog write failed')),
    };
    const stripeService = {
      syncProduct: vi.fn().mockResolvedValue({
        productId: 'prod_starter',
        monthlyPriceId: 'price_starter_month',
        setupPriceId: 'price_starter_setup',
      }),
    };
    const appRunnerConfigService = {
      syncEnvironmentVariables: vi
        .fn()
        .mockRejectedValue(new Error('APP_RUNNER_SERVICE_ARN is not configured')),
    };
    const pricingService = {
      getSummary: vi.fn().mockResolvedValue({
        packages: [buildPricingPackage()],
      }),
    };

    const service = new ProductCatalogService(
      repository as any,
      stripeService as any,
      appRunnerConfigService as any,
      pricingService as any,
    );

    const result = await service.syncProduct('STARTER', 'default', {
      code: 'STARTER',
      name: 'Vedantix Starter',
      description: 'Voor starters',
      monthlyPrice: 99,
      setupPrice: 599,
    });

    expect(result.product).toMatchObject({
      code: 'STARTER',
      stripeProductId: 'prod_starter',
      stripeMonthlyPriceId: 'price_starter_month',
      stripeSetupPriceId: 'price_starter_setup',
    });
    expect(result.appRunner).toMatchObject({
      redeployStarted: false,
      warning: 'APP_RUNNER_SERVICE_ARN is not configured',
    });
    expect(result.warnings?.join('\n')).toContain('catalog unavailable');
    expect(result.warnings?.join('\n')).toContain('catalog write failed');
    expect(result.warnings?.join('\n')).toContain(
      'APP_RUNNER_SERVICE_ARN is not configured',
    );
  });
});
