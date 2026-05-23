import { beforeAll, describe, expect, it, vi } from 'vitest';

let CustomersService: typeof import('../../../src/modules/customers/services/customers.service').CustomersService;

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

function buildCustomer(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cust_test',
    tenantId: 'default',
    companyName: 'Test BV',
    contactName: 'Test User',
    email: 'test@example.com',
    domain: 'test.nl',
    packageCode: 'STARTER',
    extras: [],
    status: 'active',
    websiteBuildStatus: 'LIVE',
    finance: {
      monthlyRevenueInclVat: 0,
      monthlyInfraCostInclVat: 0,
      oneTimeSetupInclVat: 0,
      vatRate: 0.21,
      currency: 'EUR',
    },
    base44: {
      status: 'READY',
    },
    preview: {},
    deployment: {},
    createdAt: '2026-05-20T00:00:00.000Z',
    updatedAt: '2026-05-20T00:00:00.000Z',
    createdBy: 'admin',
    updatedBy: 'admin',
    ...overrides,
  };
}

beforeAll(async () => {
  stubRequiredEnv();
  ({ CustomersService } = await import(
    '../../../src/modules/customers/services/customers.service'
  ));
});

describe('CustomersService deletion flow', () => {
  it('hides deleted and legacy cancelled customers from lists', async () => {
    const active = buildCustomer({ id: 'cust_active' });
    const softDeleted = buildCustomer({
      id: 'cust_deleted',
      deletedAt: '2026-05-20T01:00:00.000Z',
    });
    const legacyDeleted = buildCustomer({
      id: 'cust_cancelled',
      status: 'cancelled',
    });

    const repository = {
      listByTenant: vi.fn().mockResolvedValue([active, softDeleted, legacyDeleted]),
    };

    const service = new CustomersService(repository as any, {} as any);
    await expect(service.listCustomers('default')).resolves.toEqual([active]);
  });

  it('does not return deleted customers by id', async () => {
    const repository = {
      getById: vi.fn().mockResolvedValue(buildCustomer({ status: 'cancelled' })),
    };

    const service = new CustomersService(repository as any, {} as any);
    await expect(service.getCustomerById('default', 'cust_test')).resolves.toBeNull();
  });

  it('marks active customers as deleted and makes repeated deletes idempotent', async () => {
    const active = buildCustomer({ id: 'cust_active' });
    const repository = {
      getById: vi.fn().mockResolvedValue(active),
      update: vi.fn(),
    };

    const service = new CustomersService(repository as any, {} as any);
    const deleted = await service.softDeleteCustomer({
      tenantId: 'default',
      actorId: 'admin-dashboard',
      customerId: 'cust_active',
    });

    expect(deleted.status).toBe('cancelled');
    expect(deleted.deletedAt).toEqual(expect.any(String));
    expect(deleted.deletedBy).toBe('admin-dashboard');
    expect(repository.update).toHaveBeenCalledWith(deleted);

    repository.getById.mockResolvedValue(deleted);
    await expect(
      service.softDeleteCustomer({
        tenantId: 'default',
        actorId: 'admin-dashboard',
        customerId: 'cust_active',
      }),
    ).resolves.toBe(deleted);
    expect(repository.update).toHaveBeenCalledTimes(1);
  });
});

describe('CustomersService workflow updates', () => {
  it('does not persist undefined deployment fields when marking preview ready', async () => {
    const customer = buildCustomer({
      status: 'building',
      websiteBuildStatus: 'APP_LINKED',
      base44: {
        status: 'LINKED',
        appId: 'base44-app-id',
        previewUrl: 'https://nature-heals-denbosch.base44.app',
      },
      deployment: {},
    });

    const repository = {
      update: vi.fn(),
    };

    const service = new CustomersService(repository as any);
    const updated = await service.updateWorkflowState(customer as any, {
      tenantId: 'default',
      actorId: 'admin-dashboard',
      customerId: customer.id as string,
      status: 'awaiting_approval',
      websiteBuildStatus: 'PREVIEW_READY',
      previewUrl: 'https://nature-heals-denbosch.base44.app',
    });

    expect(updated.deployment).toEqual({});
    expect(Object.values(updated.deployment || {})).not.toContain(undefined);
    expect(repository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'awaiting_approval',
        websiteBuildStatus: 'PREVIEW_READY',
        deployment: {},
      }),
    );
  });
});
