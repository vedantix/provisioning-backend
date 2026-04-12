import type { Request, Response } from 'express';
import { FinanceService } from '../services/finance.service';

export class FinanceController {
  constructor(private readonly financeService = new FinanceService()) {}

  bootstrapCustomer = async (req: Request, res: Response): Promise<void> => {
    const result = await this.financeService.bootstrapCustomerFinance({
      tenantId: req.ctx.tenantId,
      customerId: req.body.customerId,
      companyName: req.body.companyName,
      packageCode: req.body.packageCode,
      extras: Array.isArray(req.body.extras) ? req.body.extras : [],
      monthlyInfraCost: req.body.monthlyInfraCost,
      oneTimeSetupCost: req.body.oneTimeSetupCost,
      isActive: req.body.isActive,
    });

    res.status(201).json({
      data: result,
      requestId: req.ctx.requestId,
    });
  };

  createExpense = async (req: Request, res: Response): Promise<void> => {
    const result = await this.financeService.createExpense({
      tenantId: req.ctx.tenantId,
      customerId: req.body.customerId,
      title: req.body.title,
      category: req.body.category,
      amount: Number(req.body.amount),
      expenseDate: req.body.expenseDate,
    });

    res.status(201).json({
      data: result,
      requestId: req.ctx.requestId,
    });
  };

  getOverview = async (req: Request, res: Response): Promise<void> => {
    const result = await this.financeService.getOverview(
      req.ctx.tenantId,
      req.query.range,
    );

    res.status(200).json({
      data: result,
      requestId: req.ctx.requestId,
    });
  };

  getCustomerDetails = async (req: Request, res: Response): Promise<void> => {
    const result = await this.financeService.getCustomerDetails(
      req.ctx.tenantId,
      String(req.params.customerId),
      req.query.range,
    );

    res.status(200).json({
      data: result,
      requestId: req.ctx.requestId,
    });
  };
}