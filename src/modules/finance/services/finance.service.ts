import crypto from 'node:crypto';
import { FinanceRepository } from '../repositories/finance.repository';
import { FinancePricingService } from './finance-pricing.service';
import type {
  CustomerFinanceDetails,
  CustomerFinanceRecord,
  FinanceExpenseRecord,
  FinanceOverview,
  FinanceRange,
} from '../types/finance.types';

function normalizeRange(input: unknown): FinanceRange {
  if (
    input === 'day' ||
    input === 'week' ||
    input === 'month' ||
    input === 'quarter' ||
    input === 'halfyear' ||
    input === 'year'
  ) {
    return input;
  }

  return 'month';
}

function isWithinRange(dateString: string, range: FinanceRange): boolean {
  const d = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const dayMs = 24 * 60 * 60 * 1000;

  switch (range) {
    case 'day':
      return diffMs <= dayMs;
    case 'week':
      return diffMs <= 7 * dayMs;
    case 'month':
      return diffMs <= 31 * dayMs;
    case 'quarter':
      return diffMs <= 92 * dayMs;
    case 'halfyear':
      return diffMs <= 183 * dayMs;
    case 'year':
      return diffMs <= 366 * dayMs;
    default:
      return diffMs <= 31 * dayMs;
  }
}

export class FinanceService {
  constructor(
    private readonly financeRepository = new FinanceRepository(),
    private readonly pricingService = new FinancePricingService(),
  ) {}

  async bootstrapCustomerFinance(input: {
    tenantId: string;
    customerId: string;
    companyName: string;
    packageCode: string;
    extras?: string[];
    monthlyInfraCost?: number;
    oneTimeSetupCost?: number;
    isActive?: boolean;
  }): Promise<CustomerFinanceRecord> {
    const now = new Date().toISOString();
    const existing = await this.financeRepository.getCustomerFinance(
      input.tenantId,
      input.customerId,
    );

    const record: CustomerFinanceRecord = {
      id: existing?.id ?? crypto.randomUUID(),
      customerId: input.customerId,
      tenantId: input.tenantId,
      companyName: input.companyName,
      packageCode: input.packageCode,
      extras: input.extras ?? [],
      monthlyRevenue: this.pricingService.getMonthlyRevenue(
        input.packageCode,
        input.extras ?? [],
      ),
      monthlyInfraCost: Number(input.monthlyInfraCost ?? 0),
      oneTimeSetupCost: Number(input.oneTimeSetupCost ?? 0),
      isActive: input.isActive ?? true,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    await this.financeRepository.upsertCustomerFinance(record);
    return record;
  }

  async createExpense(input: {
    tenantId: string;
    customerId?: string;
    title: string;
    category?: string;
    amount: number;
    expenseDate?: string;
  }): Promise<FinanceExpenseRecord> {
    const now = new Date().toISOString();

    const record: FinanceExpenseRecord = {
      id: crypto.randomUUID(),
      tenantId: input.tenantId,
      customerId: input.customerId,
      title: input.title.trim(),
      category: input.category?.trim() || 'Overig',
      amount: Number(input.amount),
      expenseDate: input.expenseDate?.trim() || now.slice(0, 10),
      createdAt: now,
      updatedAt: now,
    };

    await this.financeRepository.createExpense(record);
    return record;
  }

  async getOverview(
    tenantId: string,
    rangeInput: unknown,
  ): Promise<FinanceOverview> {
    const range = normalizeRange(rangeInput);
    const multiplier = this.pricingService.getMultiplier(range);

    const [customers, expenses] = await Promise.all([
      this.financeRepository.listCustomerFinances(tenantId),
      this.financeRepository.listExpenses(tenantId),
    ]);

    const scopedExpenses = expenses.filter((item) =>
      isWithinRange(item.expenseDate, range),
    );

    const customersWithMetrics = customers.map((customer) => {
      const directExpenses = scopedExpenses
        .filter((expense) => expense.customerId === customer.customerId)
        .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);

      const revenue = customer.monthlyRevenue * multiplier;
      const infraCosts = customer.monthlyInfraCost * multiplier;
      const costs = infraCosts + directExpenses;

      return {
        customerId: customer.customerId,
        companyName: customer.companyName,
        packageCode: customer.packageCode,
        revenue,
        costs,
        profit: revenue - costs,
        monthlyRevenue: customer.monthlyRevenue,
        monthlyInfraCost: customer.monthlyInfraCost,
        isActive: customer.isActive,
      };
    });

    const totals = customersWithMetrics.reduce(
      (acc, item) => {
        acc.revenue += item.revenue;
        acc.costs += item.costs;
        acc.profit += item.profit;
        if (item.isActive) {
          acc.activeCustomers += 1;
        }
        acc.customers += 1;
        return acc;
      },
      {
        revenue: 0,
        costs: 0,
        profit: 0,
        activeCustomers: 0,
        customers: 0,
      },
    );

    return {
      range,
      totals,
      customers: customersWithMetrics.map(({ isActive, ...rest }) => rest),
    };
  }

  async getCustomerDetails(
    tenantId: string,
    customerId: string,
    rangeInput: unknown,
  ): Promise<CustomerFinanceDetails> {
    const range = normalizeRange(rangeInput);
    const multiplier = this.pricingService.getMultiplier(range);

    const [customer, expenses] = await Promise.all([
      this.financeRepository.getCustomerFinance(tenantId, customerId),
      this.financeRepository.listExpensesByCustomer(customerId),
    ]);

    if (!customer) {
      throw new Error(`Finance customer not found: ${customerId}`);
    }

    const scopedExpenses = expenses.filter((item) =>
      isWithinRange(item.expenseDate, range),
    );

    const directExpenses = scopedExpenses.reduce(
      (sum, item) => sum + Number(item.amount || 0),
      0,
    );
    const infraCosts = customer.monthlyInfraCost * multiplier;
    const revenue = customer.monthlyRevenue * multiplier;
    const costs = infraCosts + directExpenses;

    return {
      range,
      customer: {
        customerId: customer.customerId,
        companyName: customer.companyName,
        packageCode: customer.packageCode,
        extras: customer.extras,
        monthlyRevenue: customer.monthlyRevenue,
        monthlyInfraCost: customer.monthlyInfraCost,
        oneTimeSetupCost: customer.oneTimeSetupCost,
        isActive: customer.isActive,
        createdAt: customer.createdAt,
        updatedAt: customer.updatedAt,
      },
      totals: {
        revenue,
        costs,
        profit: revenue - costs,
        infraCosts,
        directExpenses,
      },
      expenses: scopedExpenses,
    };
  }
}