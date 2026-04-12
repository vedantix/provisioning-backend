import { MailDomainsRepository } from '../repositories/mail-domains.repository';
import { ZohoMailProvider } from '../providers/zoho-mail.provider';
import type {
  CreateMailDomainInput,
  MailDomainDnsResponse,
  MailDomainRecord,
  ReconcileMailDomainInput,
} from '../types/mail.types';

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase();
}

export class MailDomainService {
  constructor(
    private readonly domainsRepository = new MailDomainsRepository(),
    private readonly mailProvider = new ZohoMailProvider(),
  ) {}

  async createDomain(input: CreateMailDomainInput): Promise<MailDomainRecord> {
    const domain = normalizeDomain(input.domain);

    const existing = await this.domainsRepository.findByDomain(domain);
    if (existing) {
      return existing;
    }

    const created = await this.mailProvider.createDomain(domain);

    return this.domainsRepository.create({
      customerId: input.customerId ?? null,
      domain,
      provider: input.provider || 'ZOHO',
      providerDomainId: created.providerDomainId,
      status: 'DNS_PENDING',
      verificationStatus: created.verificationStatus || 'PENDING',
      mailHostingEnabled: false,
      mxVerified: false,
      spfVerified: false,
      dkimVerified: false,
      dmarcVerified: false,
    });
  }

  async getDnsRecords(mailDomainId: string): Promise<MailDomainDnsResponse> {
    const domainRecord = await this.domainsRepository.findById(mailDomainId);
    if (!domainRecord) {
      throw new Error(`[MAIL_DOMAIN_SERVICE] Mail domain not found: ${mailDomainId}`);
    }

    const details = await this.mailProvider.getDomainDnsRecords(domainRecord.domain);

    return {
      domain: domainRecord.domain,
      records: details.dnsRecords || [],
    };
  }

  async reconcileDomain(input: ReconcileMailDomainInput): Promise<MailDomainRecord> {
    const domainRecord = await this.domainsRepository.findById(input.mailDomainId);
    if (!domainRecord) {
      throw new Error(`[MAIL_DOMAIN_SERVICE] Mail domain not found: ${input.mailDomainId}`);
    }

    const details = await this.mailProvider.getDomain(domainRecord.domain);
    const allVerified = Boolean(
      details.mxVerified && details.spfVerified && details.dkimVerified,
    );

    return this.domainsRepository.update(domainRecord.id, {
      providerDomainId: details.providerDomainId || domainRecord.providerDomainId,
      verificationStatus: details.verificationStatus || domainRecord.verificationStatus,
      status: allVerified ? 'ACTIVE' : 'DNS_PENDING',
      mailHostingEnabled: allVerified,
      mxVerified: Boolean(details.mxVerified),
      spfVerified: Boolean(details.spfVerified),
      dkimVerified: Boolean(details.dkimVerified),
      dmarcVerified: Boolean(details.dmarcVerified),
    });
  }

  async getById(mailDomainId: string): Promise<MailDomainRecord | null> {
    return this.domainsRepository.findById(mailDomainId);
  }

  async getByDomain(domain: string): Promise<MailDomainRecord | null> {
    return this.domainsRepository.findByDomain(normalizeDomain(domain));
  }
}