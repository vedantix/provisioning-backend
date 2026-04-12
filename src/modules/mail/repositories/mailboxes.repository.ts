import { randomUUID } from 'crypto';
import type { MailboxRecord } from '../types/mail.types';

export class MailboxesRepository {
  private readonly items = new Map<string, MailboxRecord>();

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

    this.items.set(record.id, record);
    return record;
  }

  async update(mailboxId: string, patch: Partial<MailboxRecord>): Promise<MailboxRecord> {
    const current = this.items.get(mailboxId);
    if (!current) {
      throw new Error(`[MAILBOXES_REPOSITORY] Mailbox not found: ${mailboxId}`);
    }

    const updated: MailboxRecord = {
      ...current,
      ...patch,
      id: current.id,
      updatedAt: new Date().toISOString(),
    };

    this.items.set(mailboxId, updated);
    return updated;
  }

  async findById(mailboxId: string): Promise<MailboxRecord | null> {
    return this.items.get(mailboxId) || null;
  }

  async findByEmail(primaryEmail: string): Promise<MailboxRecord | null> {
    const normalized = primaryEmail.trim().toLowerCase();

    for (const item of this.items.values()) {
      if (item.primaryEmail === normalized) {
        return item;
      }
    }

    return null;
  }

  async listByMailDomainId(mailDomainId: string): Promise<MailboxRecord[]> {
    return Array.from(this.items.values()).filter(
      (item) => item.mailDomainId === mailDomainId,
    );
  }

  async listByCustomerId(customerId: string): Promise<MailboxRecord[]> {
    return Array.from(this.items.values()).filter(
      (item) => item.customerId === customerId,
    );
  }
}