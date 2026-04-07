import { DeploymentsRepository } from '../../repositories/deployments.repository';
import type { DeploymentRecord } from '../deployments/types';

export type OrphanGuardFinding = {
  deploymentId: string;
  domain: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  type:
    | 'MISSING_BUCKET_REFERENCE'
    | 'MISSING_CERTIFICATE_REFERENCE'
    | 'MISSING_DISTRIBUTION_REFERENCE'
    | 'MISSING_ROUTE53_REFERENCE'
    | 'DELETED_BUT_RESOURCES_REMAIN'
    | 'ACTIVE_WITHOUT_CORE_RESOURCES';
  details?: Record<string, unknown>;
};

export class OrphanGuardService {
  constructor(
    private readonly deploymentsRepository = new DeploymentsRepository(),
  ) {}

  async scanDeployment(
    deploymentId: string,
  ): Promise<OrphanGuardFinding[]> {
    const deployment = await this.deploymentsRepository.getById(deploymentId);

    if (!deployment) {
      throw new Error('Deployment not found');
    }

    return this.evaluateDeployment(deployment);
  }

  async scanCandidates(): Promise<OrphanGuardFinding[]> {
    const deployments =
      await this.deploymentsRepository.listCleanupCandidates?.();

    if (!Array.isArray(deployments)) {
      return [];
    }

    return deployments.flatMap((deployment) =>
      this.evaluateDeployment(deployment as DeploymentRecord),
    );
  }

  evaluateDeployment(deployment: DeploymentRecord): OrphanGuardFinding[] {
    const findings: OrphanGuardFinding[] = [];
    const resources = deployment.managedResources;

    if (
      deployment.status !== 'DELETED' &&
      deployment.status !== 'DELETING' &&
      !resources.bucketName
    ) {
      findings.push({
        deploymentId: deployment.deploymentId,
        domain: deployment.domain,
        severity: 'HIGH',
        type: 'MISSING_BUCKET_REFERENCE',
      });
    }

    if (
      deployment.status !== 'DELETED' &&
      deployment.status !== 'DELETING' &&
      !resources.certificateArn
    ) {
      findings.push({
        deploymentId: deployment.deploymentId,
        domain: deployment.domain,
        severity: 'HIGH',
        type: 'MISSING_CERTIFICATE_REFERENCE',
      });
    }

    if (
      deployment.status !== 'DELETED' &&
      deployment.status !== 'DELETING' &&
      !resources.cloudFrontDistributionId
    ) {
      findings.push({
        deploymentId: deployment.deploymentId,
        domain: deployment.domain,
        severity: 'HIGH',
        type: 'MISSING_DISTRIBUTION_REFERENCE',
      });
    }

    if (
      deployment.status !== 'DELETED' &&
      deployment.status !== 'DELETING' &&
      !resources.hostedZoneId
    ) {
      findings.push({
        deploymentId: deployment.deploymentId,
        domain: deployment.domain,
        severity: 'MEDIUM',
        type: 'MISSING_ROUTE53_REFERENCE',
      });
    }

    if (deployment.status === 'DELETED') {
      const stillHasResources = Boolean(
        resources.bucketName ||
          resources.certificateArn ||
          resources.cloudFrontDistributionId ||
          (resources.route53AliasRecords &&
            resources.route53AliasRecords.length > 0) ||
          (resources.validationRecordFqdns &&
            resources.validationRecordFqdns.length > 0),
      );

      if (stillHasResources) {
        findings.push({
          deploymentId: deployment.deploymentId,
          domain: deployment.domain,
          severity: 'HIGH',
          type: 'DELETED_BUT_RESOURCES_REMAIN',
          details: {
            bucketName: resources.bucketName,
            certificateArn: resources.certificateArn,
            cloudFrontDistributionId: resources.cloudFrontDistributionId,
            route53AliasRecords: resources.route53AliasRecords,
            validationRecordFqdns: resources.validationRecordFqdns,
          },
        });
      }
    }

    if (
      deployment.status === 'SUCCEEDED' &&
      (!resources.bucketName ||
        !resources.certificateArn ||
        !resources.cloudFrontDistributionId)
    ) {
      findings.push({
        deploymentId: deployment.deploymentId,
        domain: deployment.domain,
        severity: 'HIGH',
        type: 'ACTIVE_WITHOUT_CORE_RESOURCES',
        details: {
          bucketName: resources.bucketName,
          certificateArn: resources.certificateArn,
          cloudFrontDistributionId: resources.cloudFrontDistributionId,
        },
      });
    }

    return findings;
  }
}