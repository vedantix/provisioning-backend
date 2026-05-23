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

  function normalizeRepositoryName(input?: string): string | undefined {
    const raw = String(input || '').trim();
    if (!raw) return undefined;

    const repoFromUrl = (() => {
      try {
        const url = new URL(raw);
        if (!url.hostname.toLowerCase().includes('github.com')) {
          return '';
        }

        const parts = url.pathname
          .replace(/\.git$/i, '')
          .split('/')
          .filter(Boolean);

        return parts.length >= 2 ? parts[1] : '';
      } catch {
        return '';
      }
    })();

    const candidate = repoFromUrl || raw.split('/').filter(Boolean).pop() || raw;
    const normalized = candidate
      .trim()
      .replace(/\.git$/i, '')
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 100);

    return normalized || undefined;
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
      sourceRepositoryName: normalizeRepositoryName(input.sourceRepositoryName),
    };
  }
