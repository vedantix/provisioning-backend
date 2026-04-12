import { randomUUID } from 'crypto';
import type { MailboxRecord } from '../types/mail.types';

const mailboxesStore = new Map<string, MailboxRecord>();

export class MailboxesRepository {
  async create(
    input: Omit<MailboxRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<MailboxRecord> {
    const now = new Date().toISOString();

    const record: MailboxRecord = {
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      ...input,
    };

    mailboxesStore.set(record.id, record);
    return record;
  }

  async update(mailboxId: string, patch: Partial<MailboxRecord>): Promise<MailboxRecord> {
    const current = mailboxesStore.get(mailboxId);
    if (!current) {
      throw new Error(`[MAILBOXES_REPOSITORY] Mailbox not found: ${mailboxId}`);
    }

    const updated: MailboxRecord = {
      ...current,
      ...patch,
      id: current.id,
      updatedAt: new Date().toISOString(),
    };

    mailboxesStore.set(mailboxId, updated);
    return updated;
  }

  async findById(mailboxId: string): Promise<MailboxRecord | null> {
    return mailboxesStore.get(mailboxId) || null;
  }

  async findByEmail(primaryEmail: string): Promise<MailboxRecord | null> {
    const normalized = primaryEmail.trim().toLowerCase();

    for (const item of mailboxesStore.values()) {
      if (item.primaryEmail === normalized) {
        return item;
      }
    }

    return null;
  }

  async listByMailDomainId(mailDomainId: string): Promise<MailboxRecord[]> {
    return Array.from(mailboxesStore.values()).filter(
      (item) => item.mailDomainId === mailDomainId,
    );
  }

  async listByCustomerId(customerId: string): Promise<MailboxRecord[]> {
    return Array.from(mailboxesStore.values()).filter(
      (item) => item.customerId === customerId,
    );
  }
}