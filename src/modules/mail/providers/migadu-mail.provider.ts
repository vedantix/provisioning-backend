import axios, { AxiosInstance } from 'axios';
import { mailConfig } from '../../../config/mail.config';
import { AppError } from '../../../errors/app-error';
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

function requireMigaduConfig(name: string, value: string): string {
  if (!value.trim()) {
    throw new AppError(
      `Mail provisioning is niet geconfigureerd. Ontbrekende environment variable: ${name}`,
      409,
      'MAIL_CONFIG_MISSING',
      { missing: [name], provider: 'MIGADU' },
    );
  }

  return value.trim();
}

function toMigaduError(error: unknown, action: string): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const details = {
      provider: 'MIGADU',
      action,
      providerStatus: status,
      providerMessage: error.response?.data,
    };

    if (status === 401 || status === 403) {
      return new AppError(
        'Migadu heeft de mail credentials geweigerd. Controleer MIGADU_USERNAME en MIGADU_PASSWORD.',
        502,
        'MAIL_PROVIDER_UNAUTHORIZED',
        details,
      );
    }

    if (status === 409 || status === 422) {
      return new AppError(
        `Migadu kon ${action} niet uitvoeren omdat het object waarschijnlijk al bestaat of ongeldig is.`,
        409,
        'MAIL_PROVIDER_CONFLICT',
        details,
      );
    }

    return new AppError(
      `Migadu request mislukt bij ${action}.`,
      502,
      'MAIL_PROVIDER_ERROR',
      details,
    );
  }

  return new AppError(
    error instanceof Error ? error.message : `Migadu request mislukt bij ${action}.`,
    502,
    'MAIL_PROVIDER_ERROR',
    { provider: 'MIGADU', action },
  );
}

export class MigaduMailProvider implements MailProvider {
  private client(): AxiosInstance {
    const username = requireMigaduConfig(
      'MIGADU_USERNAME',
      mailConfig.migadu.username,
    );
    const password = requireMigaduConfig(
      'MIGADU_PASSWORD',
      mailConfig.migadu.password,
    );

    return axios.create({
      baseURL: mailConfig.migadu.apiBaseUrl,
      timeout: mailConfig.migadu.requestTimeoutMs,
      auth: {
        username,
        password,
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
    try {
      await this.client().post('/domains', { domain_name: normalizedDomain });
    } catch (error) {
      const mapped = toMigaduError(error, 'createDomain');
      if (mapped.code !== 'MAIL_PROVIDER_CONFLICT') {
        throw mapped;
      }
    }

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
    try {
      await this.client().post(`/domains/${encodeURIComponent(normalizeDomain(input.domain))}/mailboxes`, {
        local_part: input.localPart,
        name: input.displayName,
        password: input.password,
      });
    } catch (error) {
      const mapped = toMigaduError(error, 'createMailbox');
      if (mapped.code !== 'MAIL_PROVIDER_CONFLICT') {
        throw mapped;
      }
    }

    return {
      providerAccountId: email,
      email,
      status: 'ACTIVE',
    };
  }

  async disableMailbox(input: { email: string }): Promise<void> {
    try {
      await this.client().put(`/mailboxes/${encodeURIComponent(input.email)}`, { active: false });
    } catch (error) {
      throw toMigaduError(error, 'disableMailbox');
    }
  }

  async enableMailbox(input: { email: string }): Promise<void> {
    try {
      await this.client().put(`/mailboxes/${encodeURIComponent(input.email)}`, { active: true });
    } catch (error) {
      throw toMigaduError(error, 'enableMailbox');
    }
  }

  async deleteMailbox(input: { email: string }): Promise<void> {
    try {
      await this.client().delete(`/mailboxes/${encodeURIComponent(input.email)}`);
    } catch (error) {
      throw toMigaduError(error, 'deleteMailbox');
    }
  }
}
