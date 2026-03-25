import crypto from 'node:crypto';
import { env } from '../../config/env';
import { resolvePlan } from '../plan/plan-resolver.service';
import { checkDomainAvailability } from '../domain/domain-check.service';
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
import { AddOnInput, PackageCode } from '../../types/package.types';

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function deploySite(params: {
  customerId: string;
  repo: string;
  domain: string;
  packageCode: PackageCode;
  addOns: AddOnInput[];
}) {
  const domain = ensureValidDomain(params.domain);

  const domainCheck = await checkDomainAvailability(domain);
  if (!domainCheck.canProceed) {
    return {
      success: false,
      stage: 'DOMAIN_CHECK',
      domainCheck
    };
  }

  const plan = resolvePlan(params.packageCode, params.addOns);
  const bucket = buildBucketNameFromDomain(domain);

  await createCustomerBucket(bucket);

  const certificateConfig = buildCertificateDomains(domain);
  const certificateArn = await requestCertificate(
    certificateConfig.rootDomain,
    certificateConfig.subjectAlternativeNames
  );

  const validationRecords = await getCertificateValidationRecords(certificateArn);

  for (const record of validationRecords) {
    await upsertDnsValidationRecord(record.name, record.type, record.value);
  }

  await waitForCertificateIssued(certificateArn);

  const distributionDomains = toRootAndWwwDomains(domain);

  const distribution = await createDistribution({
    bucketRegionalDomainName: `${bucket}.s3.${env.awsRegion}.amazonaws.com`,
    domainNames: distributionDomains,
    certificateArn
  });

  await upsertCloudFrontAliasRecords(
    distributionDomains,
    distribution.domainName
  );

  await dispatchDeploymentWorkflow({
    repo: params.repo,
    bucket,
    distributionId: distribution.distributionId
  });

  const deploymentId = crypto.randomUUID();
  const jobId = crypto.randomUUID();

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

  await queueJob({
    jobId,
    deploymentId,
    customerId: params.customerId,
    type: 'INITIAL_DEPLOY'
  });

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
}