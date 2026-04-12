import axios, { AxiosInstance } from 'axios';
import { mailConfig } from '../../../config/mail.config';
import { ZohoAuthService } from '../services/zoho-auth.service';
import type { MailProvider } from './mail-provider.interface';
import type {
  ProviderDnsRecord,
  ProviderDomainDetails,
  ProviderDomainResult,
  ProviderMailboxResult,
} from '../types/mail.types';

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase();
}

function normalizeEmail(localPart: string, domain: string): string {
  return `${localPart.trim().toLowerCase()}@${normalizeDomain(domain)}`;
}

export class ZohoMailProvider implements MailProvider {
  private readonly authService: ZohoAuthService;

  constructor(authService = new ZohoAuthService()) {
    this.authService = authService;
  }

  private async client(): Promise<AxiosInstance> {
    const accessToken = await this.authService.getAccessToken();

    return axios.create({
      baseURL: mailConfig.zoho.apiBaseUrl,
      timeout: mailConfig.zoho.requestTimeoutMs,
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });
  }

  private mapDnsRecords(payload: any): ProviderDnsRecord[] {
    const records = payload?.data?.dns || payload?.dns || payload?.records || [];
    if (!Array.isArray(records)) return [];

    return records.map((record: any) => ({
      type: record.recordType || record.type || 'TXT',
      host: record.host || record.name || '@',
      value: record.value || record.content || '',
      priority: record.priority ? Number(record.priority) : undefined,
      ttl: record.ttl ? Number(record.ttl) : undefined,
      purpose: record.purpose || record.label || undefined,
    }));
  }

  async createDomain(domain: string): Promise<ProviderDomainResult> {
    const normalizedDomain = normalizeDomain(domain);
    const client = await this.client();

    const response = await client.post(
      `/organization/${mailConfig.zoho.organizationId}/domains`,
      {
        domainName: normalizedDomain,
      },
    );

    const data = response.data?.data || response.data || {};

    return {
      providerDomainId: String(
        data.domainId || data.id || data.domain_id || normalizedDomain,
      ),
      domain: normalizedDomain,
      status: data.status || 'PENDING',
      verificationStatus: data.verificationStatus || data.verification_status || 'PENDING',
      dnsRecords: this.mapDnsRecords(response.data),
    };
  }

  async getDomain(domain: string): Promise<ProviderDomainDetails> {
    const normalizedDomain = normalizeDomain(domain);
    const client = await this.client();

    const response = await client.get(
      `/organization/${mailConfig.zoho.organizationId}/domains/${normalizedDomain}`,
    );

    const data = response.data?.data || response.data || {};

    return {
      providerDomainId: data.domainId || data.id || data.domain_id || normalizedDomain,
      domain: normalizedDomain,
      status: data.status || 'PENDING',
      verificationStatus: data.verificationStatus || data.verification_status || 'PENDING',
      mxVerified: Boolean(data.mxVerified ?? data.mx_verified ?? false),
      spfVerified: Boolean(data.spfVerified ?? data.spf_verified ?? false),
      dkimVerified: Boolean(data.dkimVerified ?? data.dkim_verified ?? false),
      dmarcVerified: Boolean(data.dmarcVerified ?? data.dmarc_verified ?? false),
      dnsRecords: this.mapDnsRecords(response.data),
    };
  }

  async getDomainDnsRecords(domain: string): Promise<ProviderDomainDetails> {
    const normalizedDomain = normalizeDomain(domain);
    const client = await this.client();

    const response = await client.get(
      `/organization/${mailConfig.zoho.organizationId}/domains/${normalizedDomain}/dns`,
    );

    return {
      domain: normalizedDomain,
      dnsRecords: this.mapDnsRecords(response.data),
    };
  }

  async createMailbox(input: {
    domain: string;
    localPart: string;
    displayName: string;
    password?: string;
  }): Promise<ProviderMailboxResult> {
    const client = await this.client();
    const email = normalizeEmail(input.localPart, input.domain);
  
    try {
      const response = await client.post(
        `/organization/${mailConfig.zoho.organizationId}/accounts`,
        {
          primaryEmailAddress: email,
          displayName: input.displayName,
          password: input.password,
          lastName: input.displayName,
        },
      );
  
      const data = response.data?.data || response.data || {};
  
      return {
        providerUserId: data.userId || data.id || data.user_id || undefined,
        providerAccountId: data.accountId || data.account_id || undefined,
        email,
        status: data.status || 'ACTIVE',
      };
    } catch (error: any) {
      const status = error?.response?.status;
      const data = error?.response?.data;
  
      throw new Error(
        `[ZOHO_MAIL_PROVIDER] createMailbox failed. Status=${status ?? 'unknown'} Response=${JSON.stringify(data) || error.message}`
      );
    }
  }

  async disableMailbox(input: { email: string }): Promise<void> {
    const client = await this.client();

    await client.put(
      `/organization/${mailConfig.zoho.organizationId}/accounts/${encodeURIComponent(
        input.email.trim().toLowerCase(),
      )}/status`,
      {
        status: 'DISABLED',
      },
    );
  }

  async enableMailbox(input: { email: string }): Promise<void> {
    const client = await this.client();

    await client.put(
      `/organization/${mailConfig.zoho.organizationId}/accounts/${encodeURIComponent(
        input.email.trim().toLowerCase(),
      )}/status`,
      {
        status: 'ACTIVE',
      },
    );
  }

  async deleteMailbox(input: { email: string }): Promise<void> {
    const client = await this.client();

    await client.delete(
      `/organization/${mailConfig.zoho.organizationId}/accounts/${encodeURIComponent(
        input.email.trim().toLowerCase(),
      )}`,
    );
  }
}