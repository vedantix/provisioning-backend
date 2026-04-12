import { randomUUID } from 'crypto';
import type { MailDomainRecord } from '../types/mail.types';

const mailDomainsStore = new Map<string, MailDomainRecord>();

export class MailDomainsRepository {
  async create(
    input: Omit<MailDomainRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<MailDomainRecord> {
    const now = new Date().toISOString();

    const record: MailDomainRecord = {
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      ...input,
    };

    mailDomainsStore.set(record.id, record);
    return record;
  }

  async update(
    mailDomainId: string,
    patch: Partial<MailDomainRecord>,
  ): Promise<MailDomainRecord> {
    const current = mailDomainsStore.get(mailDomainId);
    if (!current) {
      throw new Error(`[MAIL_DOMAINS_REPOSITORY] Mail domain not found: ${mailDomainId}`);
    }

    const updated: MailDomainRecord = {
      ...current,
      ...patch,
      id: current.id,
      updatedAt: new Date().toISOString(),
    };

    mailDomainsStore.set(mailDomainId, updated);
    return updated;
  }

  async findById(mailDomainId: string): Promise<MailDomainRecord | null> {
    return mailDomainsStore.get(mailDomainId) || null;
  }

  async findByDomain(domain: string): Promise<MailDomainRecord | null> {
    const normalized = domain.trim().toLowerCase();

    for (const item of mailDomainsStore.values()) {
      if (item.domain === normalized) {
        return item;
      }
    }

    return null;
  }

  async list(): Promise<MailDomainRecord[]> {
    return Array.from(mailDomainsStore.values());
  }
}