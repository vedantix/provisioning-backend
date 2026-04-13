import type { Request, Response } from "express";
import { PricingService } from "../services/pricing.service";

export class PricingController {
  constructor(private readonly pricingService = new PricingService()) {}

  getSummary = async (_req: Request, res: Response): Promise<void> => {
    const data = await this.pricingService.getSummary();
    res.status(200).json({ data });
  };

  updatePackage = async (req: Request, res: Response): Promise<void> => {
    const data = await this.pricingService.updatePackage(String(req.params.code), req.body || {});
    res.status(200).json({ data });
  };

  updateAddon = async (req: Request, res: Response): Promise<void> => {
    const data = await this.pricingService.updateAddon(String(req.params.code), req.body || {});
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