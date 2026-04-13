import type { Request, Response } from "express";
import { PricingService } from "../services/pricing.service";

function getTenantId(req: Request): string {
  return String(req.header("X-Tenant-Id") || "default").trim() || "default";
}

export class PricingController {
  constructor(private readonly pricingService = new PricingService()) {}

  getSummary = async (req: Request, res: Response): Promise<void> => {
    const tenantId = getTenantId(req);
    const data = await this.pricingService.getSummary(tenantId);
    res.status(200).json({ data });
  };

  updatePackage = async (req: Request, res: Response): Promise<void> => {
    const tenantId = getTenantId(req);
    const data = await this.pricingService.updatePackage(
      tenantId,
      String(req.params.code).toUpperCase(),
      req.body || {}
    );
    res.status(200).json({ data });
  };

  updateAddon = async (req: Request, res: Response): Promise<void> => {
    const tenantId = getTenantId(req);
    const data = await this.pricingService.updateAddon(
      tenantId,
      String(req.params.code).toUpperCase(),
      req.body || {}
    );
    res.status(200).json({ data });
  };

  getVatSummary = async (req: Request, res: Response): Promise<void> => {
    const data = this.pricingService.buildVatSummary({
      period: String(req.query.period || "month") as any,
      revenueInclVat: Number(req.query.revenueInclVat || 0),
      deductibleCostsInclVat: Number(req.query.deductibleCostsInclVat || 0),
      vatRate: Number(req.query.vatRate || 0.21),
    });

    res.status(200).json({ data });
  };
}