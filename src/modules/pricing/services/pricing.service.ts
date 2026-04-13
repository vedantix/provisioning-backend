import crypto from "node:crypto";
import { PricingRepository } from "../repositories/pricing.repository";
import type {
  PricingAddonRecord,
  PricingPackageRecord,
  PricingPeriod,
  PricingSummary,
  PricingTaxSummary,
} from "../types/pricing.types";

function fromInclusive(amountInclVat: number, vatRate: number) {
  const excl = Number((amountInclVat / (1 + vatRate)).toFixed(2));
  const vat = Number((amountInclVat - excl).toFixed(2));
  return { incl: Number(amountInclVat.toFixed(2)), excl, vat };
}

function fromExclusive(amountExclVat: number, vatRate: number) {
  const vat = Number((amountExclVat * vatRate).toFixed(2));
  const incl = Number((amountExclVat + vat).toFixed(2));
  return { incl, excl: Number(amountExclVat.toFixed(2)), vat };
}

export class PricingService {
  constructor(private readonly pricingRepository = new PricingRepository()) {}

  async getSummary(): Promise<PricingSummary> {
    await this.pricingRepository.ensureSeeded();

    const [packages, addons] = await Promise.all([
      this.pricingRepository.listPackages(),
      this.pricingRepository.listAddons(),
    ]);

    return { packages, addons };
  }

  async updatePackage(
    code: string,
    input: Partial<PricingPackageRecord> & {
      monthlyPriceInclVat?: number;
      setupPriceInclVat?: number;
      monthlyInfraCostExclVat?: number;
      vatRate?: number;
    }
  ): Promise<PricingPackageRecord> {
    await this.pricingRepository.ensureSeeded();

    const existing = await this.pricingRepository.getPackage(code);
    if (!existing) {
      throw new Error(`Pricing package not found: ${code}`);
    }

    const vatRate = Number(input.vatRate ?? existing.vatRate ?? 0.21);
    const monthly = fromInclusive(
      Number(input.monthlyPriceInclVat ?? existing.monthlyPriceInclVat),
      vatRate
    );
    const setup = fromInclusive(
      Number(input.setupPriceInclVat ?? existing.setupPriceInclVat),
      vatRate
    );
    const infra = fromExclusive(
      Number(input.monthlyInfraCostExclVat ?? existing.monthlyInfraCostExclVat),
      vatRate
    );

    const next: PricingPackageRecord = {
      ...existing,
      ...input,
      id: existing.id || crypto.randomUUID(),
      code,
      monthlyPriceInclVat: monthly.incl,
      monthlyPriceExclVat: monthly.excl,
      monthlyVatAmount: monthly.vat,
      setupPriceInclVat: setup.incl,
      setupPriceExclVat: setup.excl,
      setupVatAmount: setup.vat,
      monthlyInfraCostExclVat: infra.excl,
      monthlyInfraCostVatAmount: infra.vat,
      monthlyInfraCostInclVat: infra.incl,
      vatRate,
      updatedAt: new Date().toISOString(),
    };

    await this.pricingRepository.upsertPackage(next);
    return next;
  }

  async updateAddon(
    code: string,
    input: Partial<PricingAddonRecord> & {
      monthlyPriceInclVat?: number;
      setupPriceInclVat?: number;
      monthlyInfraCostExclVat?: number;
      vatRate?: number;
    }
  ): Promise<PricingAddonRecord> {
    await this.pricingRepository.ensureSeeded();

    const existing = await this.pricingRepository.getAddon(code);
    if (!existing) {
      throw new Error(`Pricing addon not found: ${code}`);
    }

    const vatRate = Number(input.vatRate ?? existing.vatRate ?? 0.21);
    const monthly = fromInclusive(
      Number(input.monthlyPriceInclVat ?? existing.monthlyPriceInclVat),
      vatRate
    );
    const setup = fromInclusive(
      Number(input.setupPriceInclVat ?? existing.setupPriceInclVat),
      vatRate
    );
    const infra = fromExclusive(
      Number(input.monthlyInfraCostExclVat ?? existing.monthlyInfraCostExclVat),
      vatRate
    );

    const next: PricingAddonRecord = {
      ...existing,
      ...input,
      id: existing.id || crypto.randomUUID(),
      code,
      monthlyPriceInclVat: monthly.incl,
      monthlyPriceExclVat: monthly.excl,
      monthlyVatAmount: monthly.vat,
      setupPriceInclVat: setup.incl,
      setupPriceExclVat: setup.excl,
      setupVatAmount: setup.vat,
      monthlyInfraCostExclVat: infra.excl,
      monthlyInfraCostVatAmount: infra.vat,
      monthlyInfraCostInclVat: infra.incl,
      vatRate,
      updatedAt: new Date().toISOString(),
    };

    await this.pricingRepository.upsertAddon(next);
    return next;
  }

  buildVatSummary(params: {
    period: PricingPeriod;
    revenueInclVat: number;
    deductibleCostsInclVat: number;
    vatRate?: number;
  }): PricingTaxSummary {
    const vatRate = Number(params.vatRate ?? 0.21);

    const revenueExclVat = Number((params.revenueInclVat / (1 + vatRate)).toFixed(2));
    const outputVat = Number((params.revenueInclVat - revenueExclVat).toFixed(2));

    const costsExclVat = Number((params.deductibleCostsInclVat / (1 + vatRate)).toFixed(2));
    const inputVat = Number((params.deductibleCostsInclVat - costsExclVat).toFixed(2));

    const payableVat = Number((outputVat - inputVat).toFixed(2));

    return {
      period: params.period,
      outputVat,
      inputVat,
      payableVat,
      revenueInclVat: Number(params.revenueInclVat.toFixed(2)),
      revenueExclVat,
      costsInclVat: Number(params.deductibleCostsInclVat.toFixed(2)),
      costsExclVat,
    };
  }
}