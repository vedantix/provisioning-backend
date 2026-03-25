import crypto from 'node:crypto';
import { env } from '../../config/env';
import { resolvePlan } from '../plan/plan-resolver.service';
import { checkDomainAvailability } from '../domain/domain-check.service';
import { provisionRepository } from '../github/github-provision.service';
import {
  ensureValidDomain,
  buildBucketNameFromDomain,
  buildCertificateDomains,
  toRootAndWwwDomains
} from '../../utils/domain.util';
import { createCustomerBucket } from '../aws/s3.service';
import {
  requestCertificate,
  getCertificateValidationRecords,
  waitForCertificateIssued
} from '../aws/acm.service';
import {
  upsertDnsValidationRecord,
  upsertCloudFrontAliasRecords
} from '../aws/route53.service';
import { createDistribution } from '../aws/cloudfront.service';
import { dispatchDeploymentWorkflow } from '../github/github.service';
import { putDeployment, putJob } from '../aws/dynamodb.service';
import { queueJob } from '../aws/sqs.service';
import { PackageCode, AddOnInput } from '../../types/package.types';

type DeployStage =
  | 'DOMAIN_CHECK'
  | 'GITHUB_PROVISION'
  | 'S3_BUCKET'
  | 'ACM_REQUEST'
  | 'ACM_VALIDATION_RECORDS'
  | 'ACM_WAIT'
  | 'CLOUDFRONT'
  | 'ROUTE53_ALIAS'
  | 'GITHUB_DISPATCH'
  | 'DYNAMODB'
  | 'SQS';

type DeployFailure = {
  success: false;
  stage: DeployStage;
  error: string;
  details?: unknown;
};

type DeploySuccess = {
  success: true;
  deploymentId: string;
  jobId: string;
  bucket: string;
  distributionId: string;
  cloudFrontDomainName: string;
  certificateArn: string;
  domains: string[];
  plan: unknown;
};

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'Unknown error';
}

function failure(
  stage: DeployStage,
  error: unknown,
  details?: unknown
): DeployFailure {
  return {
    success: false,
    stage,
    error: toErrorMessage(error),
    ...(details !== undefined ? { details } : {})
  };
}

export async function deploySite(params: {
  customerId: string;
  repo: string;
  domain: string;
  packageCode: PackageCode;
  addOns: AddOnInput[];
}): Promise<DeploySuccess | DeployFailure> {
  const deploymentId = crypto.randomUUID();
  const jobId = crypto.randomUUID();

  try {
    const domain = ensureValidDomain(params.domain);
    const distributionDomains = toRootAndWwwDomains(domain);
    const bucket = buildBucketNameFromDomain(domain);
    const plan = resolvePlan(params.packageCode, params.addOns);

    console.log(`[DEPLOY] Starting deploy for customer=${params.customerId}, repo=${params.repo}, domain=${domain}`);

    // 1. Domain check
    try {
      const domainCheck = await checkDomainAvailability(domain);

      if (!domainCheck.canProceed) {
        return {
          success: false,
          stage: 'DOMAIN_CHECK',
          error: 'Domain is not available for provisioning',
          details: domainCheck
        };
      }
    } catch (error) {
      return failure('DOMAIN_CHECK', error);
    }

    // 2. Ensure repo + starter files + workflow
    try {
      const repoProvision = await provisionRepository(params.repo, domain);

      if (!repoProvision.success) {
        return {
          success: false,
          stage: 'GITHUB_PROVISION',
          error: repoProvision.error ?? 'Failed to provision GitHub repository',
          details: repoProvision
        };
      }
    } catch (error) {
      return failure('GITHUB_PROVISION', error);
    }

    // 3. S3 bucket
    try {
      await createCustomerBucket(bucket);
    } catch (error) {
      return failure('S3_BUCKET', error, { bucket });
    }

    // 4. ACM certificate request
    const certificateConfig = buildCertificateDomains(domain);
    let certificateArn: string;

    try {
      certificateArn = await requestCertificate(
        certificateConfig.rootDomain,
        certificateConfig.subjectAlternativeNames
      );
    } catch (error) {
      return failure('ACM_REQUEST', error, {
        domain: certificateConfig.rootDomain,
        sans: certificateConfig.subjectAlternativeNames
      });
    }

    // 5. Write ACM validation DNS records
    try {
      const validationRecords = await getCertificateValidationRecords(certificateArn);

      for (const record of validationRecords) {
        await upsertDnsValidationRecord(record.name, record.type, record.value);
      }
    } catch (error) {
      return failure('ACM_VALIDATION_RECORDS', error, { certificateArn });
    }

    // 6. Wait until cert is really issued
    try {
      await waitForCertificateIssued(certificateArn);
    } catch (error) {
      return failure('ACM_WAIT', error, { certificateArn });
    }

    // 7. CloudFront distribution
    let distribution: {
      distributionId: string;
      domainName: string;
    };

    try {
      distribution = await createDistribution({
        bucketRegionalDomainName: `${bucket}.s3.${env.awsRegion}.amazonaws.com`,
        domainNames: distributionDomains,
        certificateArn
      });
    } catch (error) {
      return failure('CLOUDFRONT', error, {
        bucket,
        certificateArn,
        domains: distributionDomains
      });
    }

    // 8. Route53 aliases
    try {
      await upsertCloudFrontAliasRecords(
        distributionDomains,
        distribution.domainName
      );
    } catch (error) {
      return failure('ROUTE53_ALIAS', error, {
        domains: distributionDomains,
        cloudFrontDomainName: distribution.domainName
      });
    }

    // 9. Trigger site workflow in customer repo
    try {
      const dispatchResult = await dispatchDeploymentWorkflow({
        repo: params.repo,
        bucket,
        distributionId: distribution.distributionId
      });

      if (!dispatchResult.success) {
        return {
          success: false,
          stage: 'GITHUB_DISPATCH',
          error: dispatchResult.error ?? 'Failed to dispatch deployment workflow',
          details: dispatchResult
        };
      }
    } catch (error) {
      return failure('GITHUB_DISPATCH', error, {
        repo: params.repo,
        bucket,
        distributionId: distribution.distributionId
      });
    }

    // 10. Persist deployment/job state
    try {
      await putDeployment({
        id: deploymentId,
        customerId: params.customerId,
        deploymentType: 'INITIAL_DEPLOY',
        status: 'QUEUED',
        bucketName: bucket,
        cloudfrontDistributionId: distribution.distributionId,
        cloudfrontDomainName: distribution.domainName,
        certificateArn,
        planSnapshot: plan,
        domains: distributionDomains,
        createdAt: new Date().toISOString()
      });

      await putJob({
        id: jobId,
        customerId: params.customerId,
        deploymentId,
        jobType: 'INITIAL_DEPLOY',
        status: 'QUEUED',
        payload: {
          repo: params.repo,
          domain,
          bucket,
          distributionId: distribution.distributionId
        },
        createdAt: new Date().toISOString()
      });
    } catch (error) {
      return failure('DYNAMODB', error, {
        deploymentId,
        jobId
      });
    }

    // 11. Queue job
    try {
      await queueJob({
        jobId,
        deploymentId,
        customerId: params.customerId,
        type: 'INITIAL_DEPLOY'
      });
    } catch (error) {
      return failure('SQS', error, {
        jobId,
        deploymentId
      });
    }

    return {
      success: true,
      deploymentId,
      jobId,
      bucket,
      distributionId: distribution.distributionId,
      cloudFrontDomainName: distribution.domainName,
      certificateArn,
      domains: distributionDomains,
      plan
    };
  } catch (error) {
    return failure('DOMAIN_CHECK', error);
  }
}