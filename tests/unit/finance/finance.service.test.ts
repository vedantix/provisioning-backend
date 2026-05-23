import { beforeAll, describe, expect, it, vi } from 'vitest';

let FinanceService: typeof import('../../../src/modules/finance/services/finance.service').FinanceService;

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

beforeAll(async () => {
  stubRequiredEnv();
  ({ FinanceService } = await import(
    '../../../src/modules/finance/services/finance.service'
  ));
});

describe('FinanceService deletion', () => {
  it('does not create finance records for customers that are not live yet', async () => {
    const repository = {
      getCustomerFinance: vi.fn().mockResolvedValue({ customerId: 'cust_1' }),
      deleteCustomerFinance: vi.fn().mockResolvedValue(undefined),
      deleteExpensesByCustomer: vi.fn().mockResolvedValue([]),
    };
    const customersRepository = {
      getById: vi.fn().mockResolvedValue({
        id: 'cust_1',
        tenantId: 'default',
        status: 'awaiting_approval',
        websiteBuildStatus: 'PREVIEW_READY',
        deployment: {},
      }),
    };

    const service = new FinanceService(
      repository as any,
      {} as any,
      customersRepository as any,
    );
    const result = await service.bootstrapCustomerFinance({
      tenantId: 'default',
      customerId: 'cust_1',
      companyName: 'Preview BV',
      packageCode: 'STARTER',
      monthlyRevenue: 99,
      monthlyInfraCost: 10,
      oneTimeSetupCost: 999,
    });

    expect(result).toBeNull();
    expect(repository.deleteCustomerFinance).toHaveBeenCalledWith(
      'default',
      'cust_1',
    );
    expect(repository.deleteExpensesByCustomer).toHaveBeenCalledWith(
      'default',
      'cust_1',
    );
  });

  it('creates finance records when the customer is live', async () => {
    const repository = {
      getCustomerFinance: vi.fn().mockResolvedValue(null),
      upsertCustomerFinance: vi.fn().mockResolvedValue(undefined),
    };
    const customersRepository = {
      getById: vi.fn().mockResolvedValue({
        id: 'cust_1',
        tenantId: 'default',
        status: 'active',
        websiteBuildStatus: 'LIVE',
        deployment: { status: 'SUCCEEDED' },
      }),
    };

    const service = new FinanceService(
      repository as any,
      {} as any,
      customersRepository as any,
    );
    const result = await service.bootstrapCustomerFinance({
      tenantId: 'default',
      customerId: 'cust_1',
      companyName: 'Live BV',
      packageCode: 'STARTER',
      monthlyRevenue: 99,
      monthlyInfraCost: 10,
      oneTimeSetupCost: 999,
    });

    expect(result).toMatchObject({
      customerId: 'cust_1',
      monthlyRevenue: 99,
      monthlyInfraCost: 10,
      oneTimeSetupCost: 999,
      isActive: true,
    });
    expect(repository.upsertCustomerFinance).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'cust_1',
        monthlyRevenue: 99,
      }),
    );
  });

  it('deletes a customer finance record and all linked expenses', async () => {
    const expenses = [
      { id: 'exp_1', customerId: 'cust_1' },
      { id: 'exp_2', customerId: 'cust_1' },
    ];
    const repository = {
      getCustomerFinance: vi.fn().mockResolvedValue({ customerId: 'cust_1' }),
      deleteExpensesByCustomer: vi.fn().mockResolvedValue(expenses),
      deleteCustomerFinance: vi.fn().mockResolvedValue(undefined),
    };

    const service = new FinanceService(repository as any, {} as any);
    const result = await service.deleteCustomerFinance({
      tenantId: 'default',
      customerId: 'cust_1',
    });

    expect(repository.deleteExpensesByCustomer).toHaveBeenCalledWith(
      'default',
      'cust_1',
    );
    expect(repository.deleteCustomerFinance).toHaveBeenCalledWith(
      'default',
      'cust_1',
    );
    expect(result).toEqual({
      customerId: 'cust_1',
      deletedCustomerFinance: true,
      deletedExpenses: 2,
      expenseIds: ['exp_1', 'exp_2'],
    });
  });

  it('deletes one expense by id', async () => {
    const repository = {
      deleteExpenseById: vi.fn().mockResolvedValue({
        id: 'exp_1',
        customerId: 'cust_1',
      }),
    };

    const service = new FinanceService(repository as any, {} as any);
    await expect(
      service.deleteExpense({ tenantId: 'default', expenseId: 'exp_1' }),
    ).resolves.toEqual({
      expenseId: 'exp_1',
      customerId: 'cust_1',
      deleted: true,
    });
  });
});
