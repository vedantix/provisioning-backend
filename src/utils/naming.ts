export function normalizeDomain(input: string): string {
    return input.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
  }
  
  export function buildBucketName(domain: string): string {
    return `vedantix-${domain.replace(/\./g, '-')}`;
  }