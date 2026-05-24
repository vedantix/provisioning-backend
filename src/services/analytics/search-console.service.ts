import dns from 'node:dns/promises';
import { env } from '../../config/env';
import { AppError } from '../../errors/app-error';
import { logger } from '../../lib/logger';
import { upsertTxtRecord } from '../aws/route53.service';
import { GoogleServiceAccountAuth } from './google-auth.service';
import type { SearchConsoleProvisionResult } from './analytics.types';

const SEARCH_CONSOLE_SCOPE = 'https://www.googleapis.com/auth/webmasters';
const SITE_VERIFICATION_SCOPE = 'https://www.googleapis.com/auth/siteverification';

type SiteVerificationTokenResponse = {
  token?: string;
};

type SiteVerificationResourceResponse = {
  id?: string;
  site?: {
    identifier?: string;
    type?: string;
  };
};

function trimSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

function domainPropertyId(domain: string): string {
  return `sc-domain:${normalizeDomain(domain)}`;
}

function encodeSiteUrl(siteUrl: string): string {
  return encodeURIComponent(siteUrl);
}

function stripTxtQuotes(value: string): string {
  return value.trim().replace(/^"|"$/g, '');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function parseJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json().catch(() => ({}))) as Record<string, unknown>;
}

export class SearchConsoleService {
  constructor(
    private readonly auth = new GoogleServiceAccountAuth(),
    private readonly searchConsoleBaseUrl = trimSlash(env.googleSearchConsoleApiBaseUrl),
    private readonly siteVerificationBaseUrl = trimSlash(
      env.googleSiteVerificationApiBaseUrl,
    ),
  ) {}

  async createDomainProperty(domain: string): Promise<{ propertyId: string }> {
    const propertyId = domainPropertyId(domain);

    await this.searchConsoleRequest(`/sites/${encodeSiteUrl(propertyId)}`, {
      method: 'PUT',
    });

    logger.info('Search Console domain property created or reused', {
      provider: 'SEARCH_CONSOLE',
      domain: normalizeDomain(domain),
      resourceId: propertyId,
      status: 'PROVISIONED',
    });

    return { propertyId };
  }

  async getVerificationToken(domain: string): Promise<string> {
    const response = await this.siteVerificationRequest<SiteVerificationTokenResponse>(
      '/token',
      {
        method: 'POST',
        body: {
          site: {
            type: 'INET_DOMAIN',
            identifier: normalizeDomain(domain),
          },
          verificationMethod: 'DNS_TXT',
        },
      },
    );

    if (!response.token) {
      throw new AppError(
        'Google Site Verification response did not include a DNS token',
        502,
        'SEARCH_CONSOLE_INVALID_RESPONSE',
      );
    }

    return response.token;
  }

  async verifyDomain(domain: string): Promise<{ verified: boolean; propertyId: string }> {
    const response = await this.siteVerificationRequest<SiteVerificationResourceResponse>(
      '/webResource?verificationMethod=DNS_TXT',
      {
        method: 'POST',
        body: {
          site: {
            type: 'INET_DOMAIN',
            identifier: normalizeDomain(domain),
          },
        },
      },
    );

    const propertyId = response.id || domainPropertyId(domain);

    return {
      verified: true,
      propertyId,
    };
  }

  async deleteProperty(propertyIdOrDomain: string): Promise<void> {
    const propertyId = propertyIdOrDomain.startsWith('sc-domain:')
      ? propertyIdOrDomain
      : domainPropertyId(propertyIdOrDomain);

    await this.searchConsoleRequest(`/sites/${encodeSiteUrl(propertyId)}`, {
      method: 'DELETE',
    });
  }

  async reconcileProperty(input: {
    domain: string;
    hostedZoneId: string;
    customerId?: string;
    deploymentId?: string;
    existingToken?: string;
  }): Promise<SearchConsoleProvisionResult> {
    const domain = normalizeDomain(input.domain);
    let propertyId = domainPropertyId(domain);

    await this.createDomainProperty(domain)
      .then((property) => {
        propertyId = property.propertyId;
      })
      .catch((error) => {
        logger.warn('Search Console pre-verification property add failed; continuing with DNS verification', {
          provider: 'SEARCH_CONSOLE',
          customerId: input.customerId,
          deploymentId: input.deploymentId,
          domain,
          error: error instanceof Error ? error.message : String(error),
        });
      });

    const verificationToken =
      input.existingToken || (await this.getVerificationToken(domain));

    await upsertTxtRecord({
      hostedZoneId: input.hostedZoneId,
      name: domain,
      value: verificationToken,
      ttl: 300,
    });

    await this.waitForTxtPropagation({
      domain,
      token: verificationToken,
      customerId: input.customerId,
      deploymentId: input.deploymentId,
    });

    const verified = await this.verifyDomain(domain);
    const finalProperty = await this.createDomainProperty(domain);

    logger.info('Search Console domain verified', {
      provider: 'SEARCH_CONSOLE',
      customerId: input.customerId,
      deploymentId: input.deploymentId,
      domain,
      resourceId: verified.propertyId,
      status: 'VERIFIED',
    });

    return {
      propertyId: verified.propertyId || finalProperty.propertyId || propertyId,
      verificationToken,
      verificationRecordName: domain,
      verified: verified.verified,
    };
  }

  private async waitForTxtPropagation(input: {
    domain: string;
    token: string;
    customerId?: string;
    deploymentId?: string;
  }): Promise<void> {
    const maxAttempts = env.googleSearchConsoleDnsMaxAttempts;
    const delayMs = env.googleSearchConsoleDnsDelayMs;
    const expected = stripTxtQuotes(input.token);

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const records = await dns.resolveTxt(input.domain);
        const flattened = records.map((parts) => parts.join(''));

        if (flattened.some((value) => stripTxtQuotes(value) === expected)) {
          return;
        }
      } catch {
        // DNS often returns ENODATA immediately after a Route53 UPSERT.
      }

      logger.info('Waiting for Search Console TXT propagation', {
        provider: 'SEARCH_CONSOLE',
        customerId: input.customerId,
        deploymentId: input.deploymentId,
        domain: input.domain,
        attempt,
        maxAttempts,
      });

      if (attempt < maxAttempts) {
        await sleep(delayMs);
      }
    }

    throw new AppError(
      `Search Console DNS TXT verification did not propagate for ${input.domain}`,
      504,
      'SEARCH_CONSOLE_DNS_TIMEOUT',
    );
  }

  private async searchConsoleRequest<T = Record<string, unknown>>(
    path: string,
    options?: { method?: string; body?: Record<string, unknown> },
  ): Promise<T> {
    return this.googleRequest<T>(this.searchConsoleBaseUrl, path, options, [
      SEARCH_CONSOLE_SCOPE,
    ]);
  }

  private async siteVerificationRequest<T = Record<string, unknown>>(
    path: string,
    options?: { method?: string; body?: Record<string, unknown> },
  ): Promise<T> {
    return this.googleRequest<T>(this.siteVerificationBaseUrl, path, options, [
      SEARCH_CONSOLE_SCOPE,
      SITE_VERIFICATION_SCOPE,
    ]);
  }

  private async googleRequest<T>(
    baseUrl: string,
    path: string,
    options: { method?: string; body?: Record<string, unknown> } | undefined,
    scopes: string[],
  ): Promise<T> {
    const token = await this.auth.getAccessToken(scopes);
    const response = await fetch(`${baseUrl}${path}`, {
      method: options?.method ?? 'GET',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });

    if (!response.ok) {
      const payload = await parseJson(response);
      throw new AppError(
        String(
          (payload.error as { message?: string } | undefined)?.message ||
            payload.message ||
            'Google Search Console API request failed',
        ),
        response.status,
        'SEARCH_CONSOLE_API_ERROR',
        {
          path,
          status: response.status,
          payload,
        },
      );
    }

    return (await response.json().catch(() => ({}))) as T;
  }
}
