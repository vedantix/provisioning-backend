import type { AnyStage, DeploymentRecord } from './types';

export class StagePreconditionsService {
  assertStageCanRun(
    deployment: DeploymentRecord,
    stage: AnyStage,
  ): void {
    switch (stage) {
      case 'DOMAIN_CHECK':
        this.assertHasDomain(deployment);
        return;

      case 'GITHUB_PROVISION':
        this.assertHasDomain(deployment);
        return;

      case 'S3_BUCKET':
        this.assertHasDomain(deployment);
        return;

      case 'ACM_REQUEST':
        this.assertHasDomain(deployment);
        return;

      case 'ACM_VALIDATION_RECORDS':
        this.assertManagedResource(
          deployment,
          'certificateArn',
          'Missing certificateArn before ACM_VALIDATION_RECORDS',
        );
        this.assertManagedResource(
          deployment,
          'hostedZoneId',
          'Missing hostedZoneId before ACM_VALIDATION_RECORDS',
        );
        return;

      case 'ACM_DNS_PROPAGATION': {
        const validationRecords =
          deployment.stageStates['ACM_VALIDATION_RECORDS']?.output?.validationRecords;

        if (!Array.isArray(validationRecords) || validationRecords.length === 0) {
          throw new Error(
            'Missing validation records before ACM_DNS_PROPAGATION',
          );
        }
        return;
      }

      case 'ACM_WAIT':
        this.assertManagedResource(
          deployment,
          'certificateArn',
          'Missing certificateArn before ACM_WAIT',
        );
        return;

      case 'CLOUDFRONT':
        this.assertManagedResource(
          deployment,
          'bucketName',
          'Missing bucketName before CLOUDFRONT',
        );
        this.assertManagedResource(
          deployment,
          'bucketRegionalDomainName',
          'Missing bucketRegionalDomainName before CLOUDFRONT',
        );
        this.assertManagedResource(
          deployment,
          'certificateArn',
          'Missing certificateArn before CLOUDFRONT',
        );
        return;

      case 'ROUTE53_ALIAS':
        this.assertManagedResource(
          deployment,
          'hostedZoneId',
          'Missing hostedZoneId before ROUTE53_ALIAS',
        );
        this.assertManagedResource(
          deployment,
          'cloudFrontDomainName',
          'Missing cloudFrontDomainName before ROUTE53_ALIAS',
        );
        return;

      case 'GITHUB_DISPATCH':
        this.assertManagedResource(
          deployment,
          'repoName',
          'Missing repoName before GITHUB_DISPATCH',
        );
        this.assertManagedResource(
          deployment,
          'bucketName',
          'Missing bucketName before GITHUB_DISPATCH',
        );
        this.assertManagedResource(
          deployment,
          'cloudFrontDistributionId',
          'Missing cloudFrontDistributionId before GITHUB_DISPATCH',
        );
        return;

      case 'DYNAMODB':
      case 'SQS':
        this.assertHasDeploymentId(deployment);
        return;

      case 'DELETE_DOMAIN_ALIAS':
        this.assertHasDomain(deployment);
        return;

      case 'DISABLE_CLOUDFRONT':
      case 'WAIT_CLOUDFRONT_DISABLED':
      case 'DELETE_CLOUDFRONT':
        this.assertManagedResource(
          deployment,
          'cloudFrontDistributionId',
          `Missing cloudFrontDistributionId before ${stage}`,
        );
        return;

      case 'EMPTY_S3_BUCKET':
      case 'DELETE_S3_BUCKET':
        this.assertManagedResource(
          deployment,
          'bucketName',
          `Missing bucketName before ${stage}`,
        );
        return;

      case 'DELETE_ACM_VALIDATION_RECORDS':
        this.assertManagedResource(
          deployment,
          'hostedZoneId',
          `Missing hostedZoneId before ${stage}`,
        );
        return;

      case 'DELETE_ACM_CERTIFICATE':
        this.assertManagedResource(
          deployment,
          'certificateArn',
          `Missing certificateArn before ${stage}`,
        );
        return;

      case 'FINALIZE_DELETE':
        this.assertHasDeploymentId(deployment);
        return;

      default: {
        const exhaustiveCheck: never = stage;
        throw new Error(`Unsupported stage precondition check: ${exhaustiveCheck}`);
      }
    }
  }

  private assertHasDomain(deployment: DeploymentRecord): void {
    if (!deployment.domain || !deployment.rootDomain) {
      throw new Error('Deployment is missing domain information');
    }
  }

  private assertHasDeploymentId(deployment: DeploymentRecord): void {
    if (!deployment.deploymentId) {
      throw new Error('Deployment is missing deploymentId');
    }
  }

  private assertManagedResource(
    deployment: DeploymentRecord,
    key: keyof DeploymentRecord['managedResources'],
    message: string,
  ): void {
    const value = deployment.managedResources[key];
    const isMissing =
      value === undefined ||
      value === null ||
      (typeof value === 'string' && value.trim().length === 0) ||
      (Array.isArray(value) && value.length === 0);

    if (isMissing) {
      throw new Error(message);
    }
  }
}