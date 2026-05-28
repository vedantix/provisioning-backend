export type AuditEventType =
  | 'DEPLOYMENT_CREATED'
  | 'DEPLOYMENT_RESUME_REQUESTED'
  | 'DEPLOYMENT_DELETE_REQUESTED'
  | 'DEPLOYMENT_REDEPLOY_REQUESTED'
  | 'DEPLOYMENT_RETRY_STAGE_REQUESTED'
  | 'OPERATION_ACCEPTED'
  | 'STAGE_STARTED'
  | 'STAGE_SUCCEEDED'
  | 'STAGE_FAILED'
  | 'LOCK_ACQUIRED'
  | 'LOCK_CONFLICT'
  | 'ANALYTICS_PROVISION_REQUESTED'
  | 'ANALYTICS_PROVISION_SUCCEEDED'
  | 'ANALYTICS_PROVIDER_RETRY_SCHEDULED'
  | 'ANALYTICS_PROVIDER_FAILED'
  | 'ANALYTICS_DEAD_LETTERED'
  | 'ANALYTICS_DELETE_COMPLETED';

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
