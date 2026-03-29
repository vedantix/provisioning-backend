import crypto from 'node:crypto';
import { resolvePlan } from '../plan/plan-resolver.service';
import { checkDomainAvailability } from '../domain/domain-check.service';
import { provisionRepository } from '../github/github-provision.service';
import {
  ensureValidDomain,
  buildBucketNameFromDomain,
  buildCertificateDomains,
  toRootAndWwwDomains
} from '../../utils/domain.util';
import {
  buildBucketRegionalDomainName,
  createCustomerBucket,
  ensureCloudFrontReadAccess
} from '../aws/s3.service';
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
import {
  getDeploymentById,
  getJobById,
  putDeployment,
  putJob,
  updateDeployment,
  updateJob
} from '../aws/dynamodb.service';
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

type StageStatus = 'PENDING' | 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED';

type StageRecord = {
  stage: DeployStage;
  status: StageStatus;
  startedAt: string;
  completedAt?: string;
  error?: string;
  details?: unknown;
};

type DeployFailure = {
  success: false;
  stage: DeployStage;
  error: string;
  details?: unknown;
  deploymentId: string;
  jobId: string;
  stages: StageRecord[];
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
  repo: string;
  stages: StageRecord[];
};

type DeployResult = DeploySuccess | DeployFailure;

type DeployRuntimeState = {
  deploymentId: string;
  jobId: string;
  customerId: string;
  repo: string;
  domain: string;
  distributionDomains: string[];
  bucket: string;
  packageCode: PackageCode;
  addOns: AddOnInput[];
  certificateArn?: string;
  distribution?: {
    distributionId: string;
    domainName: string;
    arn?: string;
  };
  plan: unknown;
  stages: StageRecord[];
};

function nowIso(): string {
  return new Date().toISOString();
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'Unknown error';
}

function toSerializableError(error: unknown): unknown {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    };
  }

  return error;
}

function createStageRecord(stage: DeployStage): StageRecord {
  return {
    stage,
    status: 'IN_PROGRESS',
    startedAt: nowIso()
  };
}

function buildFailure(
  state: DeployRuntimeState,
  stage: DeployStage,
  error: unknown,
  details?: unknown
): DeployFailure {
  return {
    success: false,
    stage,
    error: toErrorMessage(error),
    ...(details !== undefined ? { details } : {}),
    deploymentId: state.deploymentId,
    jobId: state.jobId,
    stages: state.stages
  };
}

async function runStage<T>(
  state: DeployRuntimeState,
  stage: DeployStage,
  executor: () => Promise<T>
): Promise<{ ok: true; value: T } | { ok: false; failure: DeployFailure }> {
  const stageRecord = createStageRecord(stage);
  state.stages.push(stageRecord);

  try {
    const value = await executor();

    stageRecord.status = 'SUCCEEDED';
    stageRecord.completedAt = nowIso();

    if (value !== undefined) {
      stageRecord.details = value;
    }

    return { ok: true, value };
  } catch (error) {
    stageRecord.status = 'FAILED';
    stageRecord.completedAt = nowIso();
    stageRecord.error = toErrorMessage(error);
    stageRecord.details = toSerializableError(error);

    return {
      ok: false,
      failure: buildFailure(state, stage, error, stageRecord.details)
    };
  }
}

async function persistFailureState(
  state: DeployRuntimeState,
  failedStage: DeployStage,
  failure: DeployFailure
): Promise<void> {
  const timestamp = nowIso();

  try {
    const existingDeployment = await getDeploymentById(state.deploymentId);

    if (!existingDeployment) {
      await putDeployment({
        id: state.deploymentId,
        customerId: state.customerId,
        deploymentType: 'INITIAL_DEPLOY',
        status: 'FAILED',
        currentStage: failedStage,
        currentPackageCode: state.packageCode,
        addOns: state.addOns,
        repo: state.repo,
        bucketName: state.bucket,
        cloudfrontDistributionId: state.distribution?.distributionId,
        cloudfrontDomainName: state.distribution?.domainName,
        certificateArn: state.certificateArn,
        planSnapshot: state.plan,
        domains: state.distributionDomains,
        stages: state.stages,
        lastError: failure.error,
        lastErrorDetails: failure.details,
        createdAt: timestamp,
        updatedAt: timestamp,
        deploymentEvents: [
          {
            type: 'INITIAL_DEPLOY_FAILED',
            failedStage,
            repo: state.repo,
            domain: state.domain,
            at: timestamp
          }
        ]
      });
    } else {
      await updateDeployment({
        deploymentId: state.deploymentId,
        set: {
          status: 'FAILED',
          currentStage: failedStage,
          currentPackageCode: state.packageCode,
          addOns: state.addOns,
          repo: state.repo,
          bucketName: state.bucket,
          cloudfrontDistributionId: state.distribution?.distributionId,
          cloudfrontDomainName: state.distribution?.domainName,
          certificateArn: state.certificateArn,
          planSnapshot: state.plan,
          domains: state.distributionDomains,
          stages: state.stages,
          lastError: failure.error,
          lastErrorDetails: failure.details,
          updatedAt: timestamp
        },
        appendToLists: {
          deploymentEvents: [
            {
              type: 'INITIAL_DEPLOY_FAILED',
              failedStage,
              repo: state.repo,
              domain: state.domain,
              at: timestamp
            }
          ]
        }
      });
    }
  } catch (persistError) {
    console.error('[DEPLOY] Failed to persist deployment failure state', {
      deploymentId: state.deploymentId,
      failedStage,
      error: toErrorMessage(persistError)
    });
  }

  try {
    const existingJob = await getJobById(state.jobId);

    if (!existingJob) {
      await putJob({
        id: state.jobId,
        customerId: state.customerId,
        deploymentId: state.deploymentId,
        jobType: 'INITIAL_DEPLOY',
        status: 'FAILED',
        payload: {
          repo: state.repo,
          domain: state.domain,
          bucket: state.bucket,
          distributionId: state.distribution?.distributionId,
          failedStage,
          error: failure.error
        },
        stages: state.stages,
        lastError: failure.error,
        lastErrorDetails: failure.details,
        createdAt: timestamp,
        updatedAt: timestamp
      });
    } else {
      await updateJob({
        jobId: state.jobId,
        set: {
          status: 'FAILED',
          payload: {
            repo: state.repo,
            domain: state.domain,
            bucket: state.bucket,
            distributionId: state.distribution?.distributionId,
            failedStage,
            error: failure.error
          },
          stages: state.stages,
          lastError: failure.error,
          lastErrorDetails: failure.details,
          updatedAt: timestamp
        }
      });
    }
  } catch (persistError) {
    console.error('[DEPLOY] Failed to persist job failure state', {
      jobId: state.jobId,
      failedStage,
      error: toErrorMessage(persistError)
    });
  }
}

export async function deploySite(params: {
  customerId: string;
  repo: string;
  domain: string;
  packageCode: PackageCode;
  addOns: AddOnInput[];
}): Promise<DeployResult> {
  const deploymentId = crypto.randomUUID();
  const jobId = crypto.randomUUID();

  let normalizedDomain: string;
  let distributionDomains: string[];
  let bucket: string;
  let plan: unknown;

  try {
    normalizedDomain = ensureValidDomain(params.domain);
    distributionDomains = toRootAndWwwDomains(normalizedDomain);
    bucket = buildBucketNameFromDomain(normalizedDomain);
    plan = resolvePlan(params.packageCode, params.addOns);
  } catch (error) {
    return {
      success: false,
      stage: 'DOMAIN_CHECK',
      error: toErrorMessage(error),
      details: toSerializableError(error),
      deploymentId,
      jobId,
      stages: []
    };
  }

  const state: DeployRuntimeState = {
    deploymentId,
    jobId,
    customerId: params.customerId,
    repo: params.repo,
    domain: normalizedDomain,
    distributionDomains,
    bucket,
    packageCode: params.packageCode,
    addOns: params.addOns,
    plan,
    stages: []
  };

  console.log('[DEPLOY] Starting deploy', {
    deploymentId,
    jobId,
    customerId: params.customerId,
    repo: params.repo,
    domain: normalizedDomain,
    bucket,
    distributionDomains
  });

  // 1. DOMAIN_CHECK
  {
    const result = await runStage(state, 'DOMAIN_CHECK', async () => {
      const domainCheck = await checkDomainAvailability(normalizedDomain);

      if (!domainCheck.canProceed) {
        const error = new Error(
          `Domain is not available for provisioning (${domainCheck.status})`
        );
        (error as Error & { details?: unknown }).details = domainCheck;
        throw error;
      }

      return domainCheck;
    });

    if (!result.ok) {
      const failure = {
        ...result.failure,
        details: {
          domain: normalizedDomain,
          originalError: result.failure.details
        }
      };

      await persistFailureState(state, 'DOMAIN_CHECK', failure);
      return failure;
    }
  }

  // 2. GITHUB_PROVISION
  {
    const result = await runStage(state, 'GITHUB_PROVISION', async () => {
      const repoProvision = await provisionRepository(params.repo, normalizedDomain);

      if (!repoProvision.success) {
        throw new Error(
          `${repoProvision.stage}: ${repoProvision.error ?? 'Failed to provision GitHub repository'}`
        );
      }

      state.repo = repoProvision.repo;

      return {
        repo: repoProvision.repo,
        created: repoProvision.created,
        filesCreated: repoProvision.filesCreated,
        workflowExists: repoProvision.workflowExists,
        url: repoProvision.url,
        defaultBranch: repoProvision.defaultBranch
      };
    });

    if (!result.ok) {
      const failure = {
        ...result.failure,
        details: {
          repo: state.repo,
          domain: normalizedDomain,
          originalError: result.failure.details
        }
      };

      await persistFailureState(state, 'GITHUB_PROVISION', failure);
      return failure;
    }
  }

  // 3. S3_BUCKET
  {
    const result = await runStage(state, 'S3_BUCKET', async () => {
      const bucketResult = await createCustomerBucket(bucket);

      return {
        bucket: bucketResult.bucketName,
        existed: bucketResult.existed,
        region: bucketResult.region,
        bucketRegionalDomainName: bucketResult.bucketRegionalDomainName
      };
    });

    if (!result.ok) {
      const failure = {
        ...result.failure,
        details: {
          bucket,
          originalError: result.failure.details
        }
      };

      await persistFailureState(state, 'S3_BUCKET', failure);
      return failure;
    }
  }

  // 4. ACM_REQUEST
  {
    const result = await runStage(state, 'ACM_REQUEST', async () => {
      const certificateConfig = buildCertificateDomains(normalizedDomain);

      const certificateArn = await requestCertificate(
        certificateConfig.rootDomain,
        certificateConfig.subjectAlternativeNames
      );

      state.certificateArn = certificateArn;

      return {
        certificateArn,
        rootDomain: certificateConfig.rootDomain,
        subjectAlternativeNames: certificateConfig.subjectAlternativeNames
      };
    });

    if (!result.ok) {
      const certificateConfig = buildCertificateDomains(normalizedDomain);

      const failure = {
        ...result.failure,
        details: {
          domain: certificateConfig.rootDomain,
          sans: certificateConfig.subjectAlternativeNames,
          originalError: result.failure.details
        }
      };

      await persistFailureState(state, 'ACM_REQUEST', failure);
      return failure;
    }
  }

  // 5. ACM_VALIDATION_RECORDS
  {
    const result = await runStage(state, 'ACM_VALIDATION_RECORDS', async () => {
      if (!state.certificateArn) {
        throw new Error('Certificate ARN missing before validation record step');
      }

      const validationRecords = await getCertificateValidationRecords(state.certificateArn);

      for (const record of validationRecords) {
        await upsertDnsValidationRecord(record.name, record.type, record.value);
      }

      return {
        certificateArn: state.certificateArn,
        recordCount: validationRecords.length,
        records: validationRecords
      };
    });

    if (!result.ok) {
      const failure = {
        ...result.failure,
        details: {
          certificateArn: state.certificateArn,
          originalError: result.failure.details
        }
      };

      await persistFailureState(state, 'ACM_VALIDATION_RECORDS', failure);
      return failure;
    }
  }

  // 6. ACM_WAIT
  {
    const result = await runStage(state, 'ACM_WAIT', async () => {
      if (!state.certificateArn) {
        throw new Error('Certificate ARN missing before wait step');
      }

      await waitForCertificateIssued(state.certificateArn);

      return {
        certificateArn: state.certificateArn,
        status: 'ISSUED'
      };
    });

    if (!result.ok) {
      const failure = {
        ...result.failure,
        details: {
          certificateArn: state.certificateArn,
          originalError: result.failure.details
        }
      };

      await persistFailureState(state, 'ACM_WAIT', failure);
      return failure;
    }
  }

  // 7. CLOUDFRONT
  {
    const result = await runStage(state, 'CLOUDFRONT', async () => {
      if (!state.certificateArn) {
        throw new Error('Certificate ARN missing before CloudFront step');
      }

      const distribution = await createDistribution({
        bucketRegionalDomainName: buildBucketRegionalDomainName(bucket),
        domainNames: distributionDomains,
        certificateArn: state.certificateArn
      });

      await ensureCloudFrontReadAccess({
        bucketName: bucket,
        distributionArn: distribution.arn
      });

      state.distribution = {
        distributionId: distribution.distributionId,
        domainName: distribution.domainName,
        arn: distribution.arn
      };

      return {
        distributionId: distribution.distributionId,
        cloudFrontDomainName: distribution.domainName,
        distributionArn: distribution.arn,
        domains: distributionDomains
      };
    });

    if (!result.ok) {
      const failure = {
        ...result.failure,
        details: {
          bucket,
          certificateArn: state.certificateArn,
          domains: distributionDomains,
          originalError: result.failure.details
        }
      };

      await persistFailureState(state, 'CLOUDFRONT', failure);
      return failure;
    }
  }

  // 8. ROUTE53_ALIAS
  {
    const result = await runStage(state, 'ROUTE53_ALIAS', async () => {
      if (!state.distribution?.domainName) {
        throw new Error('CloudFront domain missing before Route53 alias step');
      }

      await upsertCloudFrontAliasRecords(
        distributionDomains,
        state.distribution.domainName
      );

      return {
        domains: distributionDomains,
        cloudFrontDomainName: state.distribution.domainName
      };
    });

    if (!result.ok) {
      const failure = {
        ...result.failure,
        details: {
          domains: distributionDomains,
          cloudFrontDomainName: state.distribution?.domainName,
          originalError: result.failure.details
        }
      };

      await persistFailureState(state, 'ROUTE53_ALIAS', failure);
      return failure;
    }
  }

  // 9. GITHUB_DISPATCH
  {
    const result = await runStage(state, 'GITHUB_DISPATCH', async () => {
      if (!state.distribution?.distributionId) {
        throw new Error('CloudFront distributionId missing before workflow dispatch');
      }

      const dispatchResult = await dispatchDeploymentWorkflow({
        repo: state.repo,
        bucket,
        distributionId: state.distribution.distributionId
      });

      if (!dispatchResult.success) {
        throw new Error(
          dispatchResult.error ?? 'Failed to dispatch deployment workflow'
        );
      }

      return {
        repo: state.repo,
        bucket,
        distributionId: state.distribution.distributionId
      };
    });

    if (!result.ok) {
      const failure = {
        ...result.failure,
        details: {
          repo: state.repo,
          bucket,
          distributionId: state.distribution?.distributionId,
          originalError: result.failure.details
        }
      };

      await persistFailureState(state, 'GITHUB_DISPATCH', failure);
      return failure;
    }
  }

  // 10. DYNAMODB
  {
    const result = await runStage(state, 'DYNAMODB', async () => {
      if (!state.certificateArn) {
        throw new Error('Certificate ARN missing before persistence');
      }

      if (!state.distribution?.distributionId || !state.distribution?.domainName) {
        throw new Error('Distribution data missing before persistence');
      }

      const timestamp = nowIso();

      await putDeployment({
        id: state.deploymentId,
        customerId: params.customerId,
        deploymentType: 'INITIAL_DEPLOY',
        status: 'QUEUED',
        currentStage: 'DYNAMODB',
        currentPackageCode: params.packageCode,
        addOns: params.addOns,
        repo: state.repo,
        bucketName: bucket,
        cloudfrontDistributionId: state.distribution.distributionId,
        cloudfrontDomainName: state.distribution.domainName,
        certificateArn: state.certificateArn,
        planSnapshot: plan,
        domains: distributionDomains,
        stages: state.stages,
        createdAt: timestamp,
        updatedAt: timestamp,
        deploymentEvents: [
          {
            type: 'INITIAL_DEPLOY_REQUESTED',
            repo: state.repo,
            domain: normalizedDomain,
            at: timestamp
          }
        ]
      });

      await putJob({
        id: state.jobId,
        customerId: params.customerId,
        deploymentId: state.deploymentId,
        jobType: 'INITIAL_DEPLOY',
        status: 'QUEUED',
        payload: {
          repo: state.repo,
          domain: normalizedDomain,
          bucket,
          distributionId: state.distribution.distributionId
        },
        stages: state.stages,
        createdAt: timestamp,
        updatedAt: timestamp
      });

      return {
        deploymentId: state.deploymentId,
        jobId: state.jobId,
        repo: state.repo
      };
    });

    if (!result.ok) {
      const failure = {
        ...result.failure,
        details: {
          deploymentId: state.deploymentId,
          jobId: state.jobId,
          originalError: result.failure.details
        }
      };

      await persistFailureState(state, 'DYNAMODB', failure);
      return failure;
    }
  }

  // 11. SQS
  {
    const result = await runStage(state, 'SQS', async () => {
      await queueJob({
        jobId: state.jobId,
        deploymentId: state.deploymentId,
        customerId: params.customerId,
        type: 'INITIAL_DEPLOY'
      });

      return {
        jobId: state.jobId,
        deploymentId: state.deploymentId,
        queued: true
      };
    });

    if (!result.ok) {
      const failure = {
        ...result.failure,
        details: {
          jobId: state.jobId,
          deploymentId: state.deploymentId,
          originalError: result.failure.details
        }
      };

      await persistFailureState(state, 'SQS', failure);
      return failure;
    }
  }

  return {
    success: true,
    deploymentId: state.deploymentId,
    jobId: state.jobId,
    bucket,
    distributionId: state.distribution!.distributionId,
    cloudFrontDomainName: state.distribution!.domainName,
    certificateArn: state.certificateArn!,
    domains: distributionDomains,
    plan,
    repo: state.repo,
    stages: state.stages
  };
}
