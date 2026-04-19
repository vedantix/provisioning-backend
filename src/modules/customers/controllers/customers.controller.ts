import type { Request, Response } from 'express';
import { CustomersService } from '../services/customers.service';
import { CustomerBase44Service } from '../services/customer-base44.service';

function getSingleParam(
  value: string | string[] | undefined,
  name: string,
): string {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }

  if (Array.isArray(value) && value.length > 0 && value[0]?.trim()) {
    return value[0].trim();
  }

  throw new Error(`[CUSTOMERS_CONTROLLER] Missing or invalid route param: ${name}`);
}

export class CustomersController {
  constructor(
    private readonly customersService = new CustomersService(),
    private readonly customerBase44Service = new CustomerBase44Service(),
  ) {}

  createCustomer = async (req: Request, res: Response): Promise<void> => {
    const customer = await this.customersService.createCustomer({
      tenantId: req.ctx.tenantId,
      createdBy: req.ctx.actorId,
      companyName: req.body.companyName,
      contactName: req.body.contactName,
      email: req.body.email,
      phone: req.body.phone,
      domain: req.body.domain,
      packageCode: req.body.packageCode,
      extras: req.body.extras,
      notes: req.body.notes,
      address: req.body.address,
      postalCode: req.body.postalCode,
      city: req.body.city,
      country: req.body.country,
      monthlyRevenueInclVat: req.body.monthlyRevenueInclVat,
      monthlyInfraCostInclVat: req.body.monthlyInfraCostInclVat,
      oneTimeSetupInclVat: req.body.oneTimeSetupInclVat,
      vatRate: req.body.vatRate,
    });

    res.status(201).json({
      data: customer,
      requestId: req.ctx.requestId,
    });
  };

  listCustomers = async (req: Request, res: Response): Promise<void> => {
    const customers = await this.customersService.listCustomers(req.ctx.tenantId);

    res.status(200).json({
      data: customers,
      requestId: req.ctx.requestId,
    });
  };

  getCustomer = async (req: Request, res: Response): Promise<void> => {
    const customerId = getSingleParam(req.params.customerId, 'customerId');

    const customer = await this.customersService.getCustomerById(
      req.ctx.tenantId,
      customerId,
    );

    if (!customer) {
      res.status(404).json({
        error: 'Customer not found',
        requestId: req.ctx.requestId,
      });
      return;
    }

    res.status(200).json({
      data: customer,
      requestId: req.ctx.requestId,
    });
  };

  linkBase44App = async (req: Request, res: Response): Promise<void> => {
    const customerId = getSingleParam(req.params.customerId, 'customerId');

    const customer = await this.customersService.getCustomerById(
      req.ctx.tenantId,
      customerId,
    );

    if (!customer) {
      res.status(404).json({
        error: 'Customer not found',
        requestId: req.ctx.requestId,
      });
      return;
    }

    const updated = await this.customerBase44Service.linkExistingApp(customer, {
      tenantId: req.ctx.tenantId,
      actorId: req.ctx.actorId,
      customerId,
      appId: req.body.appId,
      appName: req.body.appName,
      editorUrl: req.body.editorUrl,
      previewUrl: req.body.previewUrl,
      templateKey: req.body.templateKey,
      niche: req.body.niche,
      requestedPrompt: req.body.requestedPrompt,
    });

    res.status(200).json({
      data: updated,
      requestId: req.ctx.requestId,
    });
  };
}