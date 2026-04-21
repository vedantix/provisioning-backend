import { Router } from 'express';
import { CustomersRepository } from '../repositories/customers.repository';
import { Base44AutoCreateService } from '../../base44/services/base44-autocreate.service';
import { CustomerBase44Service } from '../services/customer-base44.service';

const router = Router();

const customersRepository = new CustomersRepository();
const base44Service = new Base44AutoCreateService();
const customerBase44Service = new CustomerBase44Service();

router.post(
  '/customers/:customerId/base44-app/auto',
  async (req, res) => {
    try {
      const customerId = req.params.customerId;

      if (!customerId) {
        return res.status(400).json({
          error: { code: 'INVALID_CUSTOMER_ID' },
        });
      }

      const customer = await customersRepository.getById(customerId);

      if (!customer) {
        return res.status(404).json({
          error: { code: 'CUSTOMER_NOT_FOUND' },
        });
      }

      const result = await base44Service.createApp({
        customerId: customer.id,
        companyName: customer.companyName,
        domain: customer.domain,
        packageCode: customer.packageCode,
        prompt:
          customer.requestedPrompt ??
          `Website voor ${customer.companyName}`,
      });

      const updatedCustomer = await customerBase44Service.linkExistingApp(
        customer,
        {
          tenantId: customer.tenantId,
          customerId: customer.id,
          actorId: 'system',

          appId: result.appId,
          appName: result.appName,
          editorUrl: result.editorUrl,
          previewUrl: result.previewUrl,

          templateKey: customer.templateKey,
          niche: customer.niche,
          requestedPrompt: customer.requestedPrompt,
        },
      );

      return res.status(200).json(updatedCustomer);
    } catch (error) {
      console.error('[BASE44_AUTO]', error);

      return res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message:
            error instanceof Error ? error.message : 'Unknown error',
        },
      });
    }
  },
);

export default router;