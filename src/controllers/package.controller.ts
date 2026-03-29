import type { Request, Response } from 'express';
import { upgradePackage } from '../services/package/package-upgrade.service';
import { PackageCode, AddOnInput } from '../types/package.types';

function isPackageCode(value: unknown): value is PackageCode {
  return value === 'STARTER' || value === 'GROWTH' || value === 'PRO' || value === 'CUSTOM';
}

export async function upgradePackageController(req: Request, res: Response) {
  const customerId = String(req.body?.customerId ?? '').trim();
  const deploymentId = String(req.body?.deploymentId ?? '').trim();
  const targetPackageCode = req.body?.targetPackageCode;
  const addOns = (Array.isArray(req.body?.addOns) ? req.body.addOns : []) as AddOnInput[];

  if (!customerId || !deploymentId || !targetPackageCode) {
    return res.status(400).json({
      success: false,
      error: 'customerId, deploymentId and targetPackageCode are required'
    });
  }

  if (!isPackageCode(targetPackageCode)) {
    return res.status(400).json({
      success: false,
      error: 'targetPackageCode must be one of STARTER, GROWTH, PRO, CUSTOM'
    });
  }

  const result = await upgradePackage({
    customerId,
    deploymentId,
    targetPackageCode,
    addOns
  });

  if (!result.success) {
    return res.status(409).json(result);
  }

  return res.status(200).json(result);
}