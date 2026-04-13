export type VatMode = "INCLUSIVE" | "EXCLUSIVE";

export type PricingPeriod = "month" | "quarter" | "year";

export type PricingPackageRecord = {
  id: string;
  code: string;
  label: string;
  slug: string;
  description: string;
  monthlyPriceInclVat: number;
  monthlyPriceExclVat: number;
  monthlyVatAmount: number;
  setupPriceInclVat: number;
  setupPriceExclVat: number;
  setupVatAmount: number;
  monthlyInfraCostExclVat: number;
  monthlyInfraCostVatAmount: number;
  monthlyInfraCostInclVat: number;
  vatRate: number;
  featured: boolean;
  isActive: boolean;
  sortOrder: number;
  fit: string;
  cancelNote: string;
  cta: string;
  bullets: string[];
  included: string[];
  notIncluded: string[];
  addons: string[];
  createdAt: string;
  updatedAt: string;
};

export type PricingAddonRecord = {
  id: string;
  code: string;
  label: string;
  description: string;
  monthlyPriceInclVat: number;
  monthlyPriceExclVat: number;
  monthlyVatAmount: number;
  setupPriceInclVat: number;
  setupPriceExclVat: number;
  setupVatAmount: number;
  monthlyInfraCostExclVat: number;
  monthlyInfraCostVatAmount: number;
  monthlyInfraCostInclVat: number;
  vatRate: number;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type PricingSummary = {
  packages: PricingPackageRecord[];
  addons: PricingAddonRecord[];
};

export type PricingTaxSummary = {
  period: PricingPeriod;
  outputVat: number;
  inputVat: number;
  payableVat: number;
  revenueInclVat: number;
  revenueExclVat: number;
  costsInclVat: number;
  costsExclVat: number;
};