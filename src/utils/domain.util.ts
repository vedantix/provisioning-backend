const DOMAIN_REGEX =
  /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;

export function normalizeDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '');
}

export function isValidDomain(input: string): boolean {
  const domain = normalizeDomain(input);
  return DOMAIN_REGEX.test(domain);
}

export function ensureValidDomain(input: string): string {
  const domain = normalizeDomain(input);

  if (!isValidDomain(domain)) {
    throw new Error(`Invalid domain: ${input}`);
  }

  return domain;
}

export function toWwwDomain(input: string): string {
  const domain = ensureValidDomain(input);
  return `www.${domain}`;
}

export function toRootAndWwwDomains(input: string): string[] {
  const root = ensureValidDomain(input);
  return [root, `www.${root}`];
}

export function buildBucketNameFromDomain(input: string): string {
  const domain = ensureValidDomain(input);
  return `vedantix-${domain.replace(/\./g, '-')}`;
}

export function buildCertificateDomains(input: string): {
  rootDomain: string;
  subjectAlternativeNames: string[];
} {
  const rootDomain = ensureValidDomain(input);

  return {
    rootDomain,
    subjectAlternativeNames: [`www.${rootDomain}`]
  };
}