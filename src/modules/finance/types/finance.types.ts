export type FinanceRange =
  | 'day'
  | 'week'
  | 'month'
  | 'quarter'
  | 'halfyear'
  | 'year';

export type CustomerFinanceRecord = {
  id: string;
  customerId: string;
  tenantId: string;
  companyName: string;
  packageCode: string;
  extras: string[];
  monthlyRevenue: number;
  monthlyInfraCost: number;
  oneTimeSetupCost: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type FinanceExpenseRecord = {
  id: string;
  tenantId: string;
  customerId?: string;
  title: string;
  category: string;
  amount: number;
  expenseDate: string;
  createdAt: string;
  updatedAt: string;
};

export type FinanceOverview = {
  range: FinanceRange;
  totals: {
    revenue: number;
    costs: number;
    profit: number;
    activeCustomers: number;
    customers: number;
  };
  customers: Array<{
    customerId: string;
    companyName: string;
    packageCode: string;
    revenue: number;
    costs: number;
    profit: number;
    monthlyRevenue: number;
    monthlyInfraCost: number;
  }>;
};

export type CustomerFinanceDetails = {
  range: FinanceRange;
  customer: {
    customerId: string;
    companyName: string;
    packageCode: string;
    extras: string[];
    monthlyRevenue: number;
    monthlyInfraCost: number;
    oneTimeSetupCost: number;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
  };
  totals: {
    revenue: number;
    costs: number;
    profit: number;
    infraCosts: number;
    directExpenses: number;
  };
  expenses: FinanceExpenseRecord[];
};