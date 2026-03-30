import dns from 'node:dns/promises';
import type { AcmValidationRecord } from '../../domain/deployments/stage-dependencies';

export function buildBucketNameFromDomain(domain: string): string {
  return `vedantix-${domain.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`.slice(
    0,
    63,
  );
}

export function toRootAndWwwDomains(domain: string): string[] {
  const normalized = domain.trim().toLowerCase();

  if (normalized.startsWith('www.')) {
    const root = normalized.replace(/^www\./, '');
    return [root, `www.${root}`];
  }

  return [normalized, `www.${normalized}`];
}

export function buildCertificateDomains(domain: string): {
  primary: string;
  sans: string[];
} {
  const aliases = toRootAndWwwDomains(domain);

  return {
    primary: aliases[0],
    sans: aliases.slice(1),
  };
}

export async function waitForDnsPropagation(
  records: AcmValidationRecord[],
  params?: {
    maxAttempts?: number;
    delayMs?: number;
  },
): Promise<void> {
  const maxAttempts = params?.maxAttempts ?? 20;
  const delayMs = params?.delayMs ?? 15_000;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let allResolved = true;

    for (const record of records) {
      if (!record.fqdn || record.type.toUpperCase() !== 'CNAME') {
        continue;
      }

      try {
        const resolved = await dns.resolveCname(record.fqdn);
        const found = resolved.some(
          (value) =>
            value.replace(/\.$/, '') === record.value.replace(/\.$/, ''),
        );

        if (!found) {
          allResolved = false;
          break;
        }
      } catch {
        allResolved = false;
        break;
      }
    }

    if (allResolved) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error('DNS propagation check timed out');
}