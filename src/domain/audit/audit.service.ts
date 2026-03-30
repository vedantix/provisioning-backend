import crypto from 'node:crypto';
import type { AuditEventType } from './audit.types';
import { AuditRepository } from '../../repositories/audit.repository';

export class AuditService {
  constructor(private readonly auditRepository = new AuditRepository()) {}

  async write(params: {
    deploymentId?: string;
    operationId?: string;
    tenantId: string;
    customerId?: string;
    actorId?: string;
    eventType: AuditEventType;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.auditRepository.create({
      auditEventId: crypto.randomUUID(),
      deploymentId: params.deploymentId,
      operationId: params.operationId,
      tenantId: params.tenantId,
      customerId: params.customerId,
      actorId: params.actorId,
      eventType: params.eventType,
      metadata: params.metadata,
      createdAt: new Date().toISOString(),
    });
  }
}