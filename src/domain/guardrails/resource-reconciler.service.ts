import { DeploymentConsistencyService } from '../consistency/deployment-consistency.service';
import { DeploymentsRepository } from '../../repositories/deployments.repository';
import type { DeploymentRecord } from '../deployments/types';

export type ReconcileResult = {
  deploymentId: string;
  ok: boolean;
  driftDetected: boolean;
  actions: Array<{
    type:
      | 'PATCH_HOSTED_ZONE_ID'
      | 'PATCH_ROUTE53_ALIAS_RECORD'
      | 'PATCH_CONSISTENCY_SNAPSHOT';
    details?: Record<string, unknown>;
  }>;
  consistency: Awaited<
    ReturnType<DeploymentConsistencyService['checkDeploymentState']>
  >;
};

export class ResourceReconcilerService {
  constructor(
    private readonly deploymentsRepository = new DeploymentsRepository(),
    private readonly consistencyService = new DeploymentConsistencyService(),
  ) {}

  async reconcileDeployment(deploymentId: string): Promise<ReconcileResult> {
    const deployment = await this.requireDeployment(deploymentId);
    return this.reconcile(deployment);
  }

  async reconcile(deployment: DeploymentRecord): Promise<ReconcileResult> {
    const actions: ReconcileResult['actions'] = [];

    const consistency =
      await this.consistencyService.checkDeploymentState(deployment);

    const managedResourcesPatch: Partial<DeploymentRecord['managedResources']> =
      {};

    if (!deployment.managedResources.hostedZoneId && process.env.AWS_ROUTE53_HOSTED_ZONE_ID) {
      managedResourcesPatch.hostedZoneId = process.env.AWS_ROUTE53_HOSTED_ZONE_ID;
      actions.push({
        type: 'PATCH_HOSTED_ZONE_ID',
        details: {
          hostedZoneId: process.env.AWS_ROUTE53_HOSTED_ZONE_ID,
        },
      });
    }

    if (
      consistency.checks.some(
        (check) => check.resource === 'ROUTE53_ALIAS' && check.ok,
      )
    ) {
      const existing = deployment.managedResources.route53AliasRecords ?? [];
      if (!existing.includes(deployment.domain)) {
        managedResourcesPatch.route53AliasRecords = [
          ...existing,
          deployment.domain,
        ];
        actions.push({
          type: 'PATCH_ROUTE53_ALIAS_RECORD',
          details: {
            domain: deployment.domain,
          },
        });
      }
    }

    managedResourcesPatch.consistency = {
      ok: consistency.ok,
      checkedAt: new Date().toISOString(),
      checks: consistency.checks,
    };

    actions.push({
      type: 'PATCH_CONSISTENCY_SNAPSHOT',
      details: {
        ok: consistency.ok,
      },
    });

    await this.deploymentsRepository.updateManagedResources(
      deployment.deploymentId,
      {
        ...deployment.managedResources,
        ...managedResourcesPatch,
      },
      new Date().toISOString(),
    );

    return {
      deploymentId: deployment.deploymentId,
      ok: consistency.ok,
      driftDetected: !consistency.ok,
      actions,
      consistency,
    };
  }

  private async requireDeployment(
    deploymentId: string,
  ): Promise<DeploymentRecord> {
    const deployment = await this.deploymentsRepository.getById(deploymentId);

    if (!deployment) {
      throw new Error('Deployment not found');
    }

    return deployment;
  }
}