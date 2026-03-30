import crypto from 'node:crypto';
import type { NormalizedCreateDeploymentInput } from './types';

export function createDeploymentRequestHash(
  input: NormalizedCreateDeploymentInput,
): string {
  const payload = {
    customerId: input.customerId,
    tenantId: input.tenantId,
    domain: input.domain,
    rootDomain: input.rootDomain,
    packageCode: input.packageCode,
    addOns: input.addOns,
  };

  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}