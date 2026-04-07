import type {
  AnyStage,
  DeploymentRecord,
  OperationRecord,
} from './types';

export function assertTenantAccess(
  deployment: DeploymentRecord,
  tenantId: string,
): void {
  if (deployment.tenantId !== tenantId) {
    throw new Error('Forbidden: deployment does not belong to tenant');
  }
}

export function assertCanRedeploy(deployment: DeploymentRecord): void {
  if (deployment.status === 'DELETED') {
    throw new Error('Cannot redeploy a deleted deployment');
  }
}

export function assertCanRollback(deployment: DeploymentRecord): void {
  if (deployment.status === 'DELETED') {
    throw new Error('Cannot rollback a deleted deployment');
  }

  if (!deployment.managedResources.repoName) {
    throw new Error('Cannot rollback without repoName');
  }

  if (!deployment.managedResources.bucketName) {
    throw new Error('Cannot rollback without bucketName');
  }

  if (!deployment.managedResources.cloudFrontDistributionId) {
    throw new Error('Cannot rollback without cloudFrontDistributionId');
  }

  if (
    !deployment.managedResources.rollbackRef &&
    !deployment.managedResources.lastGitRefDeployed
  ) {
    throw new Error('Cannot rollback without rollbackRef or lastGitRefDeployed');
  }
}

export function assertCanRetryStage(
  deployment: DeploymentRecord,
  stage: AnyStage,
): void {
  if (deployment.status === 'DELETED') {
    throw new Error(`Cannot retry stage ${stage} for deleted deployment`);
  }
}

export function assertNoBlockingOperation(
  operations: OperationRecord[],
): void {
  const blocking = operations.find(
    (operation) =>
      operation.status === 'ACCEPTED' || operation.status === 'RUNNING',
  );

  if (blocking) {
    throw new Error(
      `Blocking operation exists: ${blocking.operationId} (${blocking.type})`,
    );
  }
}