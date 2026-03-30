import type {
  AcmValidationRecord,
  StageDependencies,
} from './stage-dependencies';

import {
  requestCertificate,
  getCertificateValidationRecords,
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
} from '../../services/aws/s3.service';

import {
  queueJob,
} from '../../services/aws/sqs.service';

import {
  provisionRepository,
} from '../../services/github/github-provision.service';

import {
  dispatchDeploymentWorkflow,
} from '../../services/github/github.service';

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
  async domainCheck(input: { domain: string }) {
    const result = await checkDomainAvailability(input.domain);

    if (!result.canProceed) {
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

    const result = await provisionRepository(repoName, input.domain);

    if (!result.success) {
      throw new Error(
        `[${result.stage}] ${result.error}`,
      );
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
    const records = await getCertificateValidationRecords(input.certificateArn);

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

  async acmDnsPropagation(input: { records: AcmValidationRecord[] }) {
    await waitForDnsPropagation(input.records);
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
  }) {
    const result = await dispatchDeploymentWorkflow({
      repo: input.repoName,
      bucket: input.bucketName,
      distributionId: input.cloudFrontDistributionId,
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