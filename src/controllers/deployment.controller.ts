import { Request, Response } from 'express';
import { z } from 'zod';
import { deploySite } from '../services/deployment/deploy.service';
import { checkDomainAvailability } from '../services/domain/domain-check.service';
import { normalizeDomain } from '../utils/domain.util';

const addOnCodeSchema = z.enum([
  'EXTRA_MAILBOX',
  'EXTRA_STORAGE',
  'BLOG',
  'BOOKING',
  'ANALYTICS',
  'CRM',
  'FORMS',
  'SEO_PLUS',
  'PRIORITY_SUPPORT'
]);

const deploySchema = z.object({
  customerId: z.string().min(1),
  repo: z.string().min(1),
  domain: z.string().min(1),
  packageCode: z.enum(['STARTER', 'GROWTH', 'PRO', 'CUSTOM']),
  addOns: z.array(
    z.object({
      code: addOnCodeSchema,
      quantity: z.number().int().min(0)
    })
  ).default([])
});

const checkDomainSchema = z.object({
  domain: z.string().min(1)
});

export async function deployController(req: Request, res: Response) {
  try {
    const body = deploySchema.parse(req.body);

    const result = await deploySite({
      ...body,
      domain: normalizeDomain(body.domain)
    });

    if (!result.success) {
      return res.status(400).json(result);
    }

    return res.status(202).json(result);
  } catch (error) {
    console.error('deployController error:', error);

    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: error.flatten()
      });
    }

    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

export async function checkDomainController(req: Request, res: Response) {
  try {
    const body = checkDomainSchema.parse(req.body);
    const domain = normalizeDomain(body.domain);

    const result = await checkDomainAvailability(domain);

    return res.status(200).json(result);
  } catch (error) {
    console.error('checkDomainController error:', error);

    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: error.flatten()
      });
    }

    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}