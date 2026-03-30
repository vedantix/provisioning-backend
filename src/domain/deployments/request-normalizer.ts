import type {
    CreateDeploymentInput,
    NormalizedCreateDeploymentInput,
  } from './types';
  
  function normalizeDomain(input: string): string {
    return input.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  }
  
  function extractRootDomain(domain: string): string {
    const parts = domain.split('.').filter(Boolean);
    if (parts.length < 2) {
      throw new Error(`Invalid domain: ${domain}`);
    }
  
    return `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
  }
  
  export function normalizeCreateDeploymentInput(
    input: CreateDeploymentInput,
  ): NormalizedCreateDeploymentInput {
    const domain = normalizeDomain(input.domain);
    const rootDomain = extractRootDomain(domain);
  
    const addOns = [...new Set((input.addOns ?? []).map((x) => x.trim()).filter(Boolean))].sort();
  
    return {
      customerId: input.customerId.trim(),
      tenantId: input.tenantId.trim(),
      projectName: input.projectName?.trim(),
      domain,
      rootDomain,
      packageCode: input.packageCode.trim().toUpperCase(),
      addOns,
      source: input.source,
      createdBy: input.createdBy?.trim(),
      triggeredBy: input.triggeredBy?.trim(),
      idempotencyKey: input.idempotencyKey?.trim(),
    };
  }