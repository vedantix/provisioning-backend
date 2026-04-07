import type { DeploymentRecord, ManagedResources } from './types';

export type OwnershipMetadata = Record<string, string | undefined>;

export class ResourceOwnershipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResourceOwnershipError';
  }
}

export class ResourceOwnershipService {
  buildExpectedTags(deployment: DeploymentRecord): Record<string, string> {
    return {
      'vedantix:managed': 'true',
      'vedantix:deployment-id': deployment.deploymentId,
      'vedantix:tenant-id': deployment.tenantId,
      'vedantix:customer-id': deployment.customerId,
      'vedantix:domain': deployment.domain,
      'vedantix:root-domain': deployment.rootDomain,
      'vedantix:environment': process.env.NODE_ENV || 'development',
      ...(deployment.managedResources.ownershipToken
        ? {
            'vedantix:ownership-token':
              deployment.managedResources.ownershipToken,
          }
        : {}),
    };
  }

  assertS3Ownership(
    deployment: DeploymentRecord,
    actualTags?: OwnershipMetadata,
  ): void {
    this.assertOwnership('S3 bucket', deployment, actualTags, [
      'vedantix:deployment-id',
      'vedantix:tenant-id',
      'vedantix:customer-id',
    ]);
  }

  assertCloudFrontOwnership(
    deployment: DeploymentRecord,
    actualTags?: OwnershipMetadata,
  ): void {
    this.assertOwnership('CloudFront distribution', deployment, actualTags, [
      'vedantix:deployment-id',
      'vedantix:tenant-id',
      'vedantix:customer-id',
    ]);
  }

  assertCertificateOwnership(
    deployment: DeploymentRecord,
    actualTags?: OwnershipMetadata,
  ): void {
    this.assertOwnership('ACM certificate', deployment, actualTags, [
      'vedantix:deployment-id',
      'vedantix:tenant-id',
      'vedantix:customer-id',
    ]);
  }

  assertRoute53Ownership(
    deployment: DeploymentRecord,
    recordName?: string,
  ): void {
    if (!recordName) {
      throw new ResourceOwnershipError(
        'Missing Route53 record name for ownership validation',
      );
    }

    const normalizedRecordName = recordName.replace(/\.$/, '').toLowerCase();
    const expectedDomain = deployment.domain.toLowerCase();

    if (normalizedRecordName !== expectedDomain) {
      throw new ResourceOwnershipError(
        `Route53 ownership mismatch: expected ${expectedDomain}, got ${normalizedRecordName}`,
      );
    }
  }

  buildOwnershipToken(input: {
    deploymentId: string;
    tenantId: string;
    customerId: string;
    domain: string;
  }): string {
    return Buffer.from(
      [
        input.deploymentId,
        input.tenantId,
        input.customerId,
        input.domain.toLowerCase(),
      ].join('|'),
      'utf8',
    ).toString('base64url');
  }

  ensureManagedResourcesHaveOwnership(
    deployment: DeploymentRecord,
  ): ManagedResources {
    if (deployment.managedResources.ownershipToken) {
      return deployment.managedResources;
    }

    return {
      ...deployment.managedResources,
      ownershipToken: this.buildOwnershipToken({
        deploymentId: deployment.deploymentId,
        tenantId: deployment.tenantId,
        customerId: deployment.customerId,
        domain: deployment.domain,
      }),
      resourceTags: {
        ...deployment.managedResources.resourceTags,
        ...this.buildExpectedTags(deployment),
      },
    };
  }

  private assertOwnership(
    resourceType: string,
    deployment: DeploymentRecord,
    actualTags: OwnershipMetadata | undefined,
    requiredTagKeys: string[],
  ): void {
    if (!actualTags) {
      throw new ResourceOwnershipError(
        `${resourceType} ownership validation failed: missing tags`,
      );
    }

    const expected = this.buildExpectedTags(deployment);

    for (const key of requiredTagKeys) {
      const expectedValue = expected[key];
      const actualValue = actualTags[key];

      if (!expectedValue || !actualValue || expectedValue !== actualValue) {
        throw new ResourceOwnershipError(
          `${resourceType} ownership mismatch for ${key}: expected ${expectedValue}, got ${actualValue}`,
        );
      }
    }

    if (
      deployment.managedResources.ownershipToken &&
      actualTags['vedantix:ownership-token'] &&
      actualTags['vedantix:ownership-token'] !==
        deployment.managedResources.ownershipToken
    ) {
      throw new ResourceOwnershipError(
        `${resourceType} ownership token mismatch`,
      );
    }
  }
}