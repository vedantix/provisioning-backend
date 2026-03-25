import dns from 'node:dns/promises';
import axios from 'axios';
import { normalizeDomain } from '../../utils/naming';

export type DomainCheckResult = {
  domain: string;
  status: 'AVAILABLE' | 'DNS_EXISTS' | 'HTTP_ACTIVE' | 'INVALID';
  canProceed: boolean;
  details: Record<string, unknown>;
};

async function lookupSafe(domain: string, rrtype: 'A' | 'AAAA' | 'CNAME' | 'NS') {
  try {
    return await dns.resolve(domain, rrtype);
  } catch {
    return [];
  }
}

async function checkHttp(url: string): Promise<boolean> {
  try {
    await axios.get(url, {
      timeout: 4000,
      maxRedirects: 3,
      validateStatus: () => true
    });
    return true;
  } catch {
    return false;
  }
}

export async function checkDomainAvailability(input: string): Promise<DomainCheckResult> {
  const domain = normalizeDomain(input);

  if (!domain.includes('.') || domain.length < 4) {
    return {
      domain,
      status: 'INVALID',
      canProceed: false,
      details: {}
    };
  }

  const [a, aaaa, cname, ns] = await Promise.all([
    lookupSafe(domain, 'A'),
    lookupSafe(domain, 'AAAA'),
    lookupSafe(domain, 'CNAME'),
    lookupSafe(domain, 'NS')
  ]);

  if (a.length || aaaa.length || cname.length || ns.length) {
    return {
      domain,
      status: 'DNS_EXISTS',
      canProceed: false,
      details: { a, aaaa, cname, ns }
    };
  }

  const [httpRoot, httpsRoot, httpWww, httpsWww] = await Promise.all([
    checkHttp(`http://${domain}`),
    checkHttp(`https://${domain}`),
    checkHttp(`http://www.${domain}`),
    checkHttp(`https://www.${domain}`)
  ]);

  if (httpRoot || httpsRoot || httpWww || httpsWww) {
    return {
      domain,
      status: 'HTTP_ACTIVE',
      canProceed: false,
      details: { httpRoot, httpsRoot, httpWww, httpsWww }
    };
  }

  return {
    domain,
    status: 'AVAILABLE',
    canProceed: true,
    details: { a, aaaa, cname, ns }
  };
}