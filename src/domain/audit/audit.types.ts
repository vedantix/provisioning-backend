export type AuditEventType =
  | 'DEPLOYMENT_CREATED'
  | 'DEPLOYMENT_RESUME_REQUESTED'
  | 'DEPLOYMENT_DELETE_REQUESTED'
  | 'DEPLOYMENT_REDEPLOY_REQUESTED'
  | 'DEPLOYMENT_RETRY_STAGE_REQUESTED'
  | 'OPERATION_ACCEPTED'
  | 'STAGE_STARTED'
  | 'STAGE_SUCCEEDED'
  | 'STAGE_FAILED';

export type AuditEvent = {
  auditEventId: string;
  deploymentId?: string;
  operationId?: string;
  tenantId: string;
  customerId?: string;
  actorId?: string;
  eventType: AuditEventType;
  metadata?: Record<string, unknown>;
  createdAt: string;
};