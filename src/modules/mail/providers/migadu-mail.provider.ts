import axios, { AxiosInstance } from 'axios';
import { mailConfig } from '../../../config/mail.config';
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

export class MigaduMailProvider implements MailProvider {
  private client(): AxiosInstance {
    return axios.create({
      baseURL: mailConfig.migadu.apiBaseUrl,
      timeout: mailConfig.migadu.requestTimeoutMs,
      auth: {
        username: mailConfig.migadu.username,
        password: mailConfig.migadu.password,
      },
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  private mapDnsRecords(domain: string): ProviderDnsRecord[] {
    return [
      { type: 'MX', host: '@', value: 'aspmx1.migadu.com', priority: 10 },
      { type: 'MX', host: '@', value: 'aspmx2.migadu.com', priority: 20 },
      { type: 'TXT', host: '@', value: 'v=spf1 include:spf.migadu.com -all', purpose: 'SPF' },
      { type: 'CNAME', host: 'key1._domainkey', value: `key1.${domain}._domainkey.migadu.com`, purpose: 'DKIM' },
      { type: 'CNAME', host: 'key2._domainkey', value: `key2.${domain}._domainkey.migadu.com`, purpose: 'DKIM' },
      { type: 'CNAME', host: 'key3._domainkey', value: `key3.${domain}._domainkey.migadu.com`, purpose: 'DKIM' },
      { type: 'TXT', host: '_dmarc', value: 'v=DMARC1; p=quarantine;', purpose: 'DMARC' },
    ];
  }

  async createDomain(domain: string): Promise<ProviderDomainResult> {
    const normalizedDomain = normalizeDomain(domain);
    await this.client().post('/domains', { domain_name: normalizedDomain });

    return {
      providerDomainId: normalizedDomain,
      domain: normalizedDomain,
      status: 'PENDING',
      verificationStatus: 'PENDING',
      dnsRecords: this.mapDnsRecords(normalizedDomain),
    };
  }

  async getDomain(domain: string): Promise<ProviderDomainDetails> {
    const normalizedDomain = normalizeDomain(domain);
    return {
      providerDomainId: normalizedDomain,
      domain: normalizedDomain,
      status: 'ACTIVE',
      verificationStatus: 'VERIFIED',
      mxVerified: true,
      spfVerified: true,
      dkimVerified: true,
      dmarcVerified: true,
      dnsRecords: this.mapDnsRecords(normalizedDomain),
    };
  }

  async getDomainDnsRecords(domain: string): Promise<ProviderDomainDetails> {
    const normalizedDomain = normalizeDomain(domain);
    return {
      domain: normalizedDomain,
      dnsRecords: this.mapDnsRecords(normalizedDomain),
    };
  }

  async createMailbox(input: { domain: string; localPart: string; displayName: string; password?: string; }): Promise<ProviderMailboxResult> {
    const email = normalizeEmail(input.localPart, input.domain);
    await this.client().post(`/domains/${encodeURIComponent(normalizeDomain(input.domain))}/mailboxes`, {
      local_part: input.localPart,
      name: input.displayName,
      password: input.password,
    });

    return {
      providerAccountId: email,
      email,
      status: 'ACTIVE',
    };
  }

  async disableMailbox(input: { email: string }): Promise<void> {
    await this.client().put(`/mailboxes/${encodeURIComponent(input.email)}`, { active: false });
  }

  async enableMailbox(input: { email: string }): Promise<void> {
    await this.client().put(`/mailboxes/${encodeURIComponent(input.email)}`, { active: true });
  }

  async deleteMailbox(input: { email: string }): Promise<void> {
    await this.client().delete(`/mailboxes/${encodeURIComponent(input.email)}`);
  }
}
