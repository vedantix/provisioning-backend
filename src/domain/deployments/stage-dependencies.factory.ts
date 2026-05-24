import type {
  AcmValidationRecord,
  StageDependencies,
} from './stage-dependencies';

import { buildDeployWorkflow } from '../../templates/github/deploy-workflow';

import {
  requestCertificate,
  waitForCertificateValidationRecords,
  waitForCertificateIssued,
} from '../../services/aws/acm.service';

import {
  createDistribution,
} from '../../services/aws/cloudfront.service';

import {
  putDeployment,
} from '../../services/aws/dynamodb.service';

import {
  upsertDnsValidationRecord,
  upsertCloudFrontAliasRecords,
} from '../../services/aws/route53.service';

import {
  createCustomerBucket,
  ensureCloudFrontReadAccess,
} from '../../services/aws/s3.service';

import {
  queueJob,
} from '../../services/aws/sqs.service';

import {
  provisionRepository,
} from '../../services/github/github-provision.service';
import {
  generateBuildScript,
  generateIndexHtml,
  generatePackageJson,
} from '../../services/template/site-template.service';

import {
  dispatchDeploymentWorkflow,
} from '../../services/github/github.service';

import { AnalyticsProvisionService } from '../../services/analytics/analytics-provision.service';

import {
  checkDomainAvailability,
} from '../../services/domain/domain-check.service';

import {
  buildBucketNameFromDomain,
  buildCertificateDomains,
  toRootAndWwwDomains,
  waitForDnsPropagation,
} from '../../services/provisioning/provisioning.helpers';

class StageDependenciesFactoryImpl implements StageDependencies {
  constructor(
    private readonly analyticsProvisionService = new AnalyticsProvisionService(),
  ) {}

  async domainCheck(input: { domain: string }) {
    const result = await checkDomainAvailability(input.domain);

    if (!result.canProceed) {
      if (result.status === 'DOMAIN_REGISTRATION_DISABLED') {
        throw new Error(
          `Domain ${result.rootDomain} is available for registration, but automatic domain registration is disabled. Set DOMAIN_REGISTRATION_ENABLED=true and configure DOMAIN_CONTACT_* environment variables.`,
        );
      }

      if (result.status === 'DOMAIN_REGISTRATION_PENDING') {
        const registration = result.domainRegistration;
        const operationText = registration?.operationId
          ? ` OperationId: ${registration.operationId}.`
          : '';

        throw new Error(
          `Domain registration for ${result.rootDomain} is still in progress.${operationText} Retry DOMAIN_CHECK after AWS finishes the registration operation.`,
        );
      }

      if (result.status === 'DOMAIN_REGISTRATION_FAILED') {
        const registration = result.domainRegistration;

        throw new Error(
          `Domain registration failed for ${result.rootDomain}: ${registration?.errorMessage || registration?.operationMessage || 'unknown error'}`,
        );
      }

      if (result.status === 'DELEGATION_PENDING') {
        const expectedNameServers = result.expectedNameServers ?? [];
        const nameserverText = expectedNameServers.length
          ? expectedNameServers.join(', ')
          : 'geen nameservers ontvangen van Route53';

        throw new Error(
          `Route53 hosted zone ${result.hostedZoneCreated ? 'created' : 'found'} for ${result.rootDomain}, but nameserver delegation is still pending. Set the registrar nameservers to: ${nameserverText}`,
        );
      }

      throw new Error(
        `Domain cannot be used: ${input.domain} (${result.status})`,
      );
    }

    if (!result.hostedZoneId) {
      throw new Error(`Missing hostedZoneId for domain ${result.domain}`);
    }

    return {
      domain: result.domain,
      rootDomain: result.rootDomain,
      hostedZoneId: result.hostedZoneId,
      hostedZoneName: result.hostedZoneName,
      hostedZoneCreated: result.hostedZoneCreated,
      expectedNameServers: result.expectedNameServers,
      actualNameServers: result.actualNameServers,
      domainRegistration: result.domainRegistration,
    };
  }

  async githubProvision(input: {
    customerId: string;
    domain: string;
    projectName?: string;
    packageCode: string;
    addOns: string[];
  }) {
    const repoName =
      input.projectName?.trim() || this.slugify(input.domain);
    const hasSourceRepository = Boolean(input.projectName?.trim());
    const files = [
      {
        path: '.github/workflows/deploy.yml',
        content: buildDeployWorkflow(),
        message: 'Add deploy workflow',
      },
      ...(hasSourceRepository
        ? []
        : [
            {
              path: '.gitignore',
              content: `node_modules
dist
.env
`,
              message: 'Add gitignore',
            },
            {
              path: 'package.json',
              content: generatePackageJson(),
              message: 'Add package.json',
            },
            {
              path: 'scripts/build.js',
              content: generateBuildScript(),
              message: 'Add static build script',
            },
            {
              path: 'index.html',
              content: generateIndexHtml(input.domain),
              message: 'Add placeholder site',
            },
          ]),
    ];
  
    const result = await provisionRepository(
      repoName,
      input.domain,
      files,
    );
  
    if (!result.success) {
      throw new Error(`[${result.stage}] ${result.error}`);
    }
  
    return {
      repoName: result.repo,
    };
  }

  async s3Bucket(input: { domain: string }) {
    const bucketName = buildBucketNameFromDomain(input.domain);

    const result = await createCustomerBucket(bucketName);

    return {
      bucketName: result.bucketName,
      bucketRegionalDomainName: result.bucketRegionalDomainName,
    };
  }

  async acmRequest(input: { domain: string }) {
    const domains = buildCertificateDomains(input.domain);

    const certificateArn = await requestCertificate(
      domains.primary,
      domains.sans,
    );

    return {
      certificateArn,
    };
  }

  async acmValidationRecords(input: {
    certificateArn: string;
    hostedZoneId: string;
  }) {
    const records = await waitForCertificateValidationRecords(
      input.certificateArn,
    );
  
    const normalizedRecords: AcmValidationRecord[] = [];
  
    for (const record of records) {
      await upsertDnsValidationRecord(
        input.hostedZoneId,
        record.name,
        record.type,
        record.value,
      );
  
      normalizedRecords.push({
        name: record.name,
        type: record.type,
        value: record.value,
        fqdn: record.name,
      });
    }
  
    return {
      validationRecords: normalizedRecords,
      validationRecordFqdns: normalizedRecords
        .map((x) => x.fqdn)
        .filter((x): x is string => Boolean(x)),
    };
  }

  async acmDnsPropagation(_input: { records: AcmValidationRecord[] }) {
    return;
  }

  async acmWait(input: { certificateArn: string }) {
    await waitForCertificateIssued(input.certificateArn);

    return {
      certificateArn: input.certificateArn,
      certificateStatus: 'ISSUED',
    };
  }

  async cloudFront(input: {
    domain: string;
    bucketName: string;
    bucketRegionalDomainName: string;
    certificateArn: string;
  }) {
    const aliases = toRootAndWwwDomains(input.domain);

    const result = await createDistribution({
      bucketRegionalDomainName: input.bucketRegionalDomainName,
      domainNames: aliases,
      certificateArn: input.certificateArn,
    });

    if (result.arn) {
      await ensureCloudFrontReadAccess({
        bucketName: input.bucketName,
        distributionArn: result.arn,
      });
    }

    return {
      distributionId: result.distributionId,
      domainName: result.domainName,
      arn: result.arn,
      oacId: result.oacId,
    };
  }

  async route53Alias(input: {
    domain: string;
    rootDomain: string;
    hostedZoneId: string;
    cloudFrontDomainName: string;
  }) {
    const aliases = toRootAndWwwDomains(input.domain);

    const result = await upsertCloudFrontAliasRecords(
      input.hostedZoneId,
      aliases,
      input.cloudFrontDomainName,
    );

    return {
      aliasRecords: result.upsertedDomains,
    };
  }

  async githubDispatch(input: {
    repoName: string;
    domain: string;
    bucketName: string;
    cloudFrontDistributionId: string;
    trackingEnvironment?: Record<string, string>;
  }) {
    const result = await dispatchDeploymentWorkflow({
      repo: input.repoName,
      bucket: input.bucketName,
      distributionId: input.cloudFrontDistributionId,
      analyticsEnv: input.trackingEnvironment,
    });

    if (!result.success) {
      throw new Error(
        `[${result.stage}] ${result.error}`,
      );
    }

    return {
      workflowRunId: `dispatch-${Date.now()}`,
    };
  }

  async googleAnalytics(input: {
    tenantId: string;
    customerId: string;
    deploymentId: string;
    domain: string;
    displayName?: string;
  }) {
    const result = await this.analyticsProvisionService.provisionGoogleAnalytics({
      tenantId: input.tenantId,
      customerId: input.customerId,
      deploymentId: input.deploymentId,
      domain: input.domain,
      displayName: input.displayName,
    });

    return {
      propertyId: result.googleAnalytics.propertyId || '',
      dataStreamId: result.googleAnalytics.dataStreamId,
      measurementId: result.googleAnalytics.measurementId || '',
    };
  }

  async searchConsole(input: {
    tenantId: string;
    customerId: string;
    deploymentId: string;
    domain: string;
    displayName?: string;
    hostedZoneId: string;
  }) {
    const result = await this.analyticsProvisionService.provisionSearchConsole({
      tenantId: input.tenantId,
      customerId: input.customerId,
      deploymentId: input.deploymentId,
      domain: input.domain,
      displayName: input.displayName,
      hostedZoneId: input.hostedZoneId,
    });

    return {
      propertyId: result.searchConsole.propertyId || '',
      verified: result.searchConsole.verified,
      verificationRecordName: result.searchConsole.verificationRecordName,
    };
  }

  async clarity(input: {
    tenantId: string;
    customerId: string;
    deploymentId: string;
    domain: string;
    displayName?: string;
  }) {
    const result = await this.analyticsProvisionService.provisionClarity({
      tenantId: input.tenantId,
      customerId: input.customerId,
      deploymentId: input.deploymentId,
      domain: input.domain,
      displayName: input.displayName,
    });

    return {
      projectId: result.clarity.projectId,
      skipped: result.clarity.status === 'SKIPPED',
      trackingEnvironment: result.trackingEnvironment,
    };
  }

  async dynamoDbSync(_input: { deploymentId: string }) {
    return;
  }

  async sqs(input: {
    deploymentId: string;
    customerId: string;
    domain: string;
  }) {
    const messageId = await queueJob({
      type: 'POST_DEPLOYMENT_SYNC',
      deploymentId: input.deploymentId,
      customerId: input.customerId,
      domain: input.domain,
    });

    return {
      messageId,
      queueType: 'POST_DEPLOYMENT_SYNC',
    };
  }

  private slugify(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
}

export function createStageDependencies(): StageDependencies {
  return new StageDependenciesFactoryImpl();
}
