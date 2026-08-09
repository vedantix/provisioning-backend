import {
  CheckDomainAvailabilityCommand,
  ListPricesCommand,
  Route53DomainsClient,
} from '@aws-sdk/client-route-53-domains';
import { parse } from 'tldts';
import { env } from '../../config/env';

export type DomainInspectionResult = {
  domain: string;
  rootDomain: string;
  tld: string;
  availability: string;
  registrationPrice?: { currency?: string; price?: number };
  renewalPrice?: { currency?: string; price?: number };
  readOnly: true;
};

const client = new Route53DomainsClient({
  region: env.awsRoute53DomainsRegion,
});

function normalizeDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/\.$/, '');
}

export async function inspectDomainReadOnly(input: string): Promise<DomainInspectionResult> {
  const domain = normalizeDomain(input);
  const parsed = parse(domain);

  if (!parsed.isIcann || !parsed.domain || !parsed.publicSuffix) {
    throw new Error('Domain is not a valid ICANN domain');
  }

  const rootDomain = parsed.domain;
  const tld = `.${parsed.publicSuffix}`;

  const [availabilityResult, priceResult] = await Promise.all([
    client.send(
      new CheckDomainAvailabilityCommand({
        DomainName: rootDomain,
      }),
    ),
    client.send(
      new ListPricesCommand({
        Tld: tld,
      }),
    ),
  ]);

  const price = priceResult.Prices?.[0];

  return {
    domain,
    rootDomain,
    tld,
    availability: availabilityResult.Availability ?? 'DONT_KNOW',
    registrationPrice: price?.RegistrationPrice
      ? {
          currency: price.RegistrationPrice.Currency,
          price: price.RegistrationPrice.Price,
        }
      : undefined,
    renewalPrice: price?.RenewalPrice
      ? {
          currency: price.RenewalPrice.Currency,
          price: price.RenewalPrice.Price,
        }
      : undefined,
    readOnly: true,
  };
}
