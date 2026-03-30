import crypto from "crypto";

import { checkDomainAvailability } from "../domain/domain-check.service";
import { provisionRepository } from "../github/github-provision.service";
import { dispatchDeploymentWorkflow } from "../github/github.service";
import { resolvePlan } from "../plan/plan-resolver.service";

import {
  createCustomerBucket,
  ensureCloudFrontReadAccess,
} from "../aws/s3.service";
import {
  requestCertificate,
  getCertificateValidationRecords,
  waitForCertificateIssued,
} from "../aws/acm.service";
import {
  upsertDnsValidationRecord,
  upsertCloudFrontAliasRecords,
} from "../aws/route53.service";
import { createDistribution } from "../aws/cloudfront.service";
import {
  putDeployment,
  putJob,
  updateDeployment,
  updateJob,
  getJobById,
} from "../aws/dynamodb.service";
import { queueJob } from "../aws/sqs.service";

import {
  ensureValidDomain,
  normalizeDomain,
  buildBucketNameFromDomain,
  buildCertificateDomains,
  toRootAndWwwDomains,
} from "../../utils/domain.util";

import type {
  AddOnInput,
  PackageCode,
  ResolvedPlan,
} from "../../types/package.types";

export type JobStatus =
  | "QUEUED"
  | "RUNNING"
  | "FAILED"
  | "SUCCEEDED"
  | "DELETED";

export type DeploymentStatus =
  | "QUEUED"
  | "RUNNING"
  | "FAILED"
  | "SUCCEEDED"
  | "DELETED";

export type DeployStage =
  | "DOMAIN_CHECK"
  | "GITHUB_PROVISION"
  | "S3_BUCKET"
  | "ACM_REQUEST"
  | "ACM_VALIDATION_RECORDS"
  | "ACM_WAIT"
  | "CLOUDFRONT"
  | "ROUTE53_ALIAS"
  | "GITHUB_DISPATCH"
  | "DYNAMODB"
  | "SQS";

export interface DeployRequest {
  customerId: string;
  projectName: string;
  domain: string;
  packageCode: PackageCode;
  addOns?: AddOnInput[];
  initiatedBy?: string;
  metadata?: Record<string, unknown>;
}

interface DeploymentEvent {
  type:
  | "DEPLOYMENT_CREATED"
  | "STAGE_STARTED"
  | "STAGE_COMPLETED"
  | "DEPLOYMENT_FAILED"
  | "DEPLOYMENT_SUCCEEDED";
  stage?: DeployStage;
  failedStage?: DeployStage;
  message?: string;
  domain: string;
  repo?: string;
  at: string;
  details?: Record<string, unknown>;
}

interface PersistContext {
  deploymentId: string;
  jobId: string;
  domain: string;
  repo: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function toErrorDetails(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    message: String(error),
  };
}

async function markStageRunning(
  ctx: PersistContext,
  stage: DeployStage,
  extra?: Record<string, unknown>
): Promise<void> {
  const at = nowIso();

  await Promise.all([
    updateDeployment({
      deploymentId: ctx.deploymentId,
      set: {
        status: "RUNNING" as DeploymentStatus,
        currentStage: stage,
        updatedAt: at,
        ...extra,
      },
      appendToLists: {
        deploymentEvents: [
          {
            type: "STAGE_STARTED",
            stage,
            domain: ctx.domain,
            repo: ctx.repo,
            at,
          } as DeploymentEvent,
        ],
      },
    }),
    updateJob({
      jobId: ctx.jobId,
      set: {
        status: "RUNNING" as JobStatus,
        currentStage: stage,
        updatedAt: at,
        ...extra,
      },
    }),
  ]);
}

async function markStageCompleted(
  ctx: PersistContext,
  stage: DeployStage,
  extra?: Record<string, unknown>
): Promise<void> {
  const at = nowIso();

  await Promise.all([
    updateDeployment({
      deploymentId: ctx.deploymentId,
      set: {
        currentStage: stage,
        updatedAt: at,
        ...extra,
      },
      appendToLists: {
        deploymentEvents: [
          {
            type: "STAGE_COMPLETED",
            stage,
            domain: ctx.domain,
            repo: ctx.repo,
            at,
          } as DeploymentEvent,
        ],
      },
    }),
    updateJob({
      jobId: ctx.jobId,
      set: {
        currentStage: stage,
        updatedAt: at,
        ...extra,
      },
    }),
  ]);
}

async function markDeploymentFailed(
  ctx: PersistContext,
  stage: DeployStage,
  error: unknown,
  extra?: Record<string, unknown>
): Promise<void> {
  const at = nowIso();
  const errorMessage = toErrorMessage(error);
  const errorDetails = toErrorDetails(error);

  await Promise.all([
    updateDeployment({
      deploymentId: ctx.deploymentId,
      set: {
        status: "FAILED" as DeploymentStatus,
        currentStage: stage,
        failureReason: errorMessage,
        lastError: errorMessage,
        lastErrorDetails: errorDetails,
        updatedAt: at,
        ...extra,
      },
      appendToLists: {
        deploymentEvents: [
          {
            type: "DEPLOYMENT_FAILED",
            stage,
            failedStage: stage,
            message: errorMessage,
            domain: ctx.domain,
            repo: ctx.repo,
            at,
            details: errorDetails,
          } as DeploymentEvent,
        ],
      },
    }),
    updateJob({
      jobId: ctx.jobId,
      set: {
        status: "FAILED" as JobStatus,
        currentStage: stage,
        lastError: errorMessage,
        lastErrorDetails: errorDetails,
        updatedAt: at,
        ...extra,
      },
    }),
  ]);
}

async function markDeploymentSucceeded(
  ctx: PersistContext,
  extra?: Record<string, unknown>
): Promise<void> {
  const at = nowIso();

  await Promise.all([
    updateDeployment({
      deploymentId: ctx.deploymentId,
      set: {
        status: "SUCCEEDED" as DeploymentStatus,
        currentStage: "SQS" as DeployStage,
        deployedAt: at,
        updatedAt: at,
        ...extra,
      },
      appendToLists: {
        deploymentEvents: [
          {
            type: "DEPLOYMENT_SUCCEEDED",
            stage: "SQS",
            domain: ctx.domain,
            repo: ctx.repo,
            at,
          } as DeploymentEvent,
        ],
      },
    }),
    updateJob({
      jobId: ctx.jobId,
      set: {
        status: "SUCCEEDED" as JobStatus,
        currentStage: "SQS" as DeployStage,
        completedAt: at,
        updatedAt: at,
        ...extra,
      },
    }),
  ]);
}

async function inferCurrentStageSafe(jobId: string): Promise<DeployStage> {
  try {
    const job = await getJobById(jobId);
    return (job?.currentStage as DeployStage | undefined) ?? "DOMAIN_CHECK";
  } catch {
    return "DOMAIN_CHECK";
  }
}

function buildDeployWorkflowFile(): string {
  return `name: Deploy website

on:
  workflow_dispatch:
    inputs:
      bucket:
        description: S3 bucket name
        required: true
        type: string
      distribution_id:
        description: CloudFront distribution id
        required: true
        type: string
      mode:
        description: deploy or rollback
        required: true
        default: deploy
        type: string
      target_ref:
        description: target git ref for rollback
        required: false
        type: string

jobs:
  deploy:
    runs-on: ubuntu-latest

    permissions:
      contents: read

    steps:
      - name: Checkout current ref
        if: \${{ inputs.mode == 'deploy' }}
        uses: actions/checkout@v4

      - name: Checkout rollback ref
        if: \${{ inputs.mode == 'rollback' }}
        uses: actions/checkout@v4
        with:
          ref: \${{ inputs.target_ref }}

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: \${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: \${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: eu-west-1

      - name: Upload site to S3
        run: aws s3 sync . s3://\${{ inputs.bucket }} --delete --exclude ".git/*" --exclude ".github/*"

      - name: Invalidate CloudFront
        run: aws cloudfront create-invalidation --distribution-id \${{ inputs.distribution_id }} --paths "/*"
`;
}

export async function deployWebsite(input: DeployRequest) {
  const deploymentId = createId("dep");
  const jobId = createId("job");
  const createdAt = nowIso();

  const normalizedDomain = normalizeDomain(input.domain);
  ensureValidDomain(normalizedDomain);

  const repoName = input.projectName.trim();
  const addOns = input.addOns ?? [];
  const bucketName = buildBucketNameFromDomain(normalizedDomain);
  const certDomains = buildCertificateDomains(normalizedDomain);
  const allDomains = toRootAndWwwDomains(normalizedDomain);

  const plan: ResolvedPlan = resolvePlan(input.packageCode, addOns);

  const ctx: PersistContext = {
    deploymentId,
    jobId,
    domain: normalizedDomain,
    repo: repoName,
  };

  await putDeployment({
    id: deploymentId,
    deploymentId,
    customerId: input.customerId,
    deploymentType: "INITIAL_DEPLOY",
    projectName: repoName,
    primaryDomain: normalizedDomain,
    domains: allDomains,
    packageCode: input.packageCode,
    currentPackageCode: input.packageCode,
    addOns,
    status: "QUEUED",
    currentStage: "DOMAIN_CHECK",
    createdAt,
    updatedAt: createdAt,
    metadata: input.metadata ?? {},
    deploymentEvents: [
      {
        type: "DEPLOYMENT_CREATED",
        stage: "DOMAIN_CHECK",
        domain: normalizedDomain,
        repo: repoName,
        at: createdAt,
        details: {
          packageCode: input.packageCode,
          addOns,
        },
      } satisfies DeploymentEvent,
    ],
  });

  await putJob({
    id: jobId,
    jobId,
    customerId: input.customerId,
    deploymentId,
    jobType: "DEPLOYMENT",
    status: "QUEUED",
    currentStage: "DOMAIN_CHECK",
    createdAt,
    updatedAt: createdAt,
    initiatedBy: input.initiatedBy ?? "system",
    payload: {
      projectName: repoName,
      domain: normalizedDomain,
      packageCode: input.packageCode,
      addOns,
    },
  });

  try {
    // 1. DOMAIN_CHECK
    await markStageRunning(ctx, "DOMAIN_CHECK");

    const availability = await checkDomainAvailability(normalizedDomain);

    if (!availability.canProceed) {
      throw new Error(
        `Domain check failed for ${normalizedDomain}: ${availability.status}`
      );
    }

    if (!availability.hostedZoneId) {
      throw new Error(
        `Domain check succeeded but hostedZoneId is missing for ${normalizedDomain}`
      );
    }

    const hostedZoneId = availability.hostedZoneId;
    const rootDomain = availability.rootDomain;

    await markStageCompleted(ctx, "DOMAIN_CHECK", {
      domainCheck: availability,
      hostedZoneId,
      rootDomain,
    });

    // 2. GITHUB_PROVISION
    await markStageRunning(ctx, "GITHUB_PROVISION");

    const provisionFiles = [
      {
        path: ".github/workflows/deploy.yml",
        content: buildDeployWorkflowFile(),
        message: `Add deploy workflow for ${normalizedDomain}`,
      },
    ];

    const provisionResult = await provisionRepository(
      repoName,
      normalizedDomain,
      provisionFiles
    );

    if (!provisionResult.success) {
      throw new Error(
        `GitHub provisioning failed at stage ${provisionResult.stage}: ${provisionResult.error}`
      );
    }

    if (!provisionResult.workflowExists) {
      throw new Error(
        `GitHub provisioning completed, but no deployment workflow exists in repo ${provisionResult.repo}`
      );
    }

    await markStageCompleted(ctx, "GITHUB_PROVISION", {
      repo: provisionResult.repo,
      repoUrl: provisionResult.url,
      githubProvisioning: {
        created: provisionResult.created,
        filesCreated: provisionResult.filesCreated,
        workflowExists: provisionResult.workflowExists,
        details: provisionResult.details,
      },
    });

    // 3. S3_BUCKET
    await markStageRunning(ctx, "S3_BUCKET");

    const bucketResult = await createCustomerBucket(bucketName, {
      tags: {
        "deployment-id": deploymentId,
        "customer-id": input.customerId,
      },
    });

    await markStageCompleted(ctx, "S3_BUCKET", {
      bucketName: bucketResult.bucketName,
      bucketRegion: bucketResult.region,
      bucketExisted: bucketResult.existed,
      bucketRegionalDomainName: bucketResult.bucketRegionalDomainName,
    });

    // 4. ACM_REQUEST
    await markStageRunning(ctx, "ACM_REQUEST");

    const certificateArn = await requestCertificate(
      certDomains.rootDomain,
      certDomains.subjectAlternativeNames
    );

    await markStageCompleted(ctx, "ACM_REQUEST", {
      certificateArn,
      certificateDomains: certDomains,
    });

    // 5. ACM_VALIDATION_RECORDS
    await markStageRunning(ctx, "ACM_VALIDATION_RECORDS");

    const validationRecords = await getCertificateValidationRecords(certificateArn);

    const validationResults: Array<{
      name: string;
      type: string;
      hostedZoneId: string;
      upserted: true;
    }> = [];

    for (const record of validationRecords) {
      const result = await upsertDnsValidationRecord(
        hostedZoneId,
        record.name,
        record.type,
        record.value
      );

      validationResults.push(result);
    }

    await markStageCompleted(ctx, "ACM_VALIDATION_RECORDS", {
      hostedZoneId,
      certificateValidationRecords: validationRecords,
      certificateValidationResults: validationResults,
    });

    // 6. ACM_WAIT
    await markStageRunning(ctx, "ACM_WAIT");

    await waitForCertificateIssued(certificateArn);

    await markStageCompleted(ctx, "ACM_WAIT", {
      certificateStatus: "ISSUED",
    });

    // 7. CLOUDFRONT
    await markStageRunning(ctx, "CLOUDFRONT");

    const distribution = await createDistribution({
      bucketRegionalDomainName: bucketResult.bucketRegionalDomainName,
      domainNames: allDomains,
      certificateArn,
    });

    await ensureCloudFrontReadAccess({
      bucketName,
      distributionArn: distribution.arn,
    });

    await markStageCompleted(ctx, "CLOUDFRONT", {
      cloudfrontDistributionId: distribution.distributionId,
      cloudfrontDistributionArn: distribution.arn,
      cloudfrontDomainName: distribution.domainName,
      cloudfrontAliases: distribution.aliases,
      cloudfrontCreated: distribution.created,
      cloudfrontUpdated: distribution.updated,
      oacId: distribution.oacId,
    });

    // 8. ROUTE53_ALIAS
    await markStageRunning(ctx, "ROUTE53_ALIAS");

    const aliasResult = await upsertCloudFrontAliasRecords(
      hostedZoneId,
      allDomains,
      distribution.domainName
    );

    await markStageCompleted(ctx, "ROUTE53_ALIAS", {
      hostedZoneId,
      route53Aliases: aliasResult.upsertedDomains,
      route53CloudFrontDomainName: aliasResult.cloudFrontDomainName,
    });

    // 9. GITHUB_DISPATCH
    await markStageRunning(ctx, "GITHUB_DISPATCH");

    const dispatchResult = await dispatchDeploymentWorkflow({
      repo: provisionResult.repo,
      bucket: bucketName,
      distributionId: distribution.distributionId,
      ref: provisionResult.defaultBranch,
    });

    if (!dispatchResult.success) {
      throw new Error(`GitHub deployment dispatch failed: ${dispatchResult.error}`);
    }

    await markStageCompleted(ctx, "GITHUB_DISPATCH", {
      githubDispatch: dispatchResult.details,
    });

    // 10. DYNAMODB
    await markStageRunning(ctx, "DYNAMODB");

    await Promise.all([
      updateDeployment({
        deploymentId,
        set: {
          repo: provisionResult.repo,
          repoUrl: provisionResult.url,
          defaultBranch: provisionResult.defaultBranch,
          bucketName: bucketResult.bucketName,
          bucketRegion: bucketResult.region,
          bucketRegionalDomainName: bucketResult.bucketRegionalDomainName,
          certificateArn,
          certificateDomains: certDomains,
          hostedZoneId,
          rootDomain,
          cloudfrontDistributionId: distribution.distributionId,
          cloudfrontDomainName: distribution.domainName,
          domains: allDomains,
          planSnapshot: plan,
        },
      }),
      updateJob({
        jobId,
        set: {
          payload: {
            customerId: input.customerId,
            projectName: repoName,
            domain: normalizedDomain,
            rootDomain,
            hostedZoneId,
            packageCode: input.packageCode,
            addOns,
            repo: provisionResult.repo,
            bucketName: bucketResult.bucketName,
            certificateArn,
            distributionId: distribution.distributionId,
          },
        },
      }),
    ]);

    await markStageCompleted(ctx, "DYNAMODB");

    // 11. SQS
    await markStageRunning(ctx, "SQS");

    const messageId = await queueJob({
      type: "POST_DEPLOYMENT_SYNC",
      deploymentId,
      jobId,
      payload: {
        customerId: input.customerId,
        domain: normalizedDomain,
        rootDomain,
        hostedZoneId,
        repo: provisionResult.repo,
      },
    });

    await markStageCompleted(ctx, "SQS", {
      queuedMessageId: messageId,
    });

    await markDeploymentSucceeded(ctx, {
      queuedMessageId: messageId,
    });

    return {
      success: true,
      deploymentId,
      jobId,
      status: "SUCCEEDED" as const,
      domain: normalizedDomain,
      rootDomain,
      hostedZoneId,
      repo: provisionResult.repo,
      bucketName: bucketResult.bucketName,
      certificateArn,
      distributionId: distribution.distributionId,
      cloudfrontDomainName: distribution.domainName,
      queuedMessageId: messageId,
    };
  } catch (error) {
    const failedStage = await inferCurrentStageSafe(jobId);
    await markDeploymentFailed(ctx, failedStage, error);
    throw error;
  }
}