import type {
  AnyStage,
  DeploymentRecord,
  DeploymentStatus,
  OperationRecord,
} from './types';
import { ForbiddenError, ConflictHttpError } from '../../errors/app-error';

const RETRYABLE_STATUSES: DeploymentStatus[] = ['FAILED'];
const REDEPLOYABLE_STATUSES: DeploymentStatus[] = ['SUCCEEDED', 'FAILED'];
const BLOCKING_OPERATION_STATUSES = new Set(['ACCEPTED', 'RUNNING']);

export function assertTenantAccess(
  deployment: DeploymentRecord,
  tenantId: string,
): void {
  if (deployment.tenantId !== tenantId) {
    throw new ForbiddenError('Forbidden');
  }
}

export function assertCanRedeploy(deployment: DeploymentRecord): void {
  if (!REDEPLOYABLE_STATUSES.includes(deployment.status)) {
    throw new ConflictHttpError(
      `Deployment status ${deployment.status} cannot be redeployed`,
    );
  }

  if (!deployment.managedResources.repoName) {
    throw new ConflictHttpError('Cannot redeploy without repoName');
  }

  if (!deployment.managedResources.bucketName) {
    throw new ConflictHttpError('Cannot redeploy without bucketName');
  }

  if (!deployment.managedResources.cloudFrontDistributionId) {
    throw new ConflictHttpError(
      'Cannot redeploy without cloudFrontDistributionId',
    );
  }
}

export function assertCanRetryStage(
  deployment: DeploymentRecord,
  stage: AnyStage,
): void {
  if (!RETRYABLE_STATUSES.includes(deployment.status)) {
    throw new ConflictHttpError(
      `Deployment status ${deployment.status} cannot retry stages`,
    );
  }

  const stageState = deployment.stageStates?.[stage];

  if (!stageState) {
    throw new ConflictHttpError(
      `Stage ${stage} has no recorded execution state`,
    );
  }

  if (stageState.status !== 'FAILED') {
    throw new ConflictHttpError(`Stage ${stage} is not in FAILED state`);
  }

  if (!stageState.retryable) {
    throw new ConflictHttpError(`Stage ${stage} is marked as non-retryable`);
  }
}

export function assertNoBlockingOperation(
  operations: OperationRecord[],
  currentOperationId?: string,
): void {
  const blocking = operations.find(
    (op) =>
      op.operationId !== currentOperationId &&
      BLOCKING_OPERATION_STATUSES.has(op.status),
  );

  if (blocking) {
    throw new ConflictHttpError(
      `Another operation is already active: ${blocking.type} (${blocking.status})`,
    );
  }
}