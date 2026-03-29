import crypto from "crypto";

import {
  ensureValidDomain,
  buildCertificateDomains,
  toRootAndWwwDomains,
} from "../../utils/domain.util";
import { checkDomainAvailability } from "./domain-check.service";
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
  buildBucketRegionalDomainName,
  ensureCloudFrontReadAccess,
} from "../aws/s3.service";
import {
  getDeploymentById,
  putJob,
  updateDeployment,
  updateJob,
} from "../aws/dynamodb.service";

import type {
  AddDomainRequest,
  AddDomainResult,
  AddDomainStage,
  AddDomainStageRecord,
  DomainOwnershipCheckResult,
} from "./domain.types";

type JobStatus =
  | "QUEUED"
  | "RUNNING"
  | "FAILED"
  | "SUCCEEDED"
  | "DELETED";

type DeploymentStatus =
  | "QUEUED"
  | "RUNNING"
  | "FAILED"
  | "SUCCEEDED"
  | "DELETED";

interface DomainEvent {
  type:
  | "DOMAIN_ADD_STARTED"
  | "DOMAIN_ADD_FAILED"
  | "DOMAIN_ADDED"
  | "DOMAIN_STAGE_STARTED"
  | "DOMAIN_STAGE_COMPLETED";
  domain: string;
  domainsApplied?: string[];
  stage?: AddDomainStage;
  message?: string;
  at: string;
  details?: Record<string, unknown>;
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

  if (typeof error === "string") {
    return error;
  }

  return "Unknown error";
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

function createStage(stage: AddDomainStage): AddDomainStageRecord {
  return {
    stage,
    status: "IN_PROGRESS",
    startedAt: nowIso(),
  };
}

async function appendDomainEvent(params: {
  deploymentId: string;
  event: DomainEvent;
}): Promise<void> {
  await updateDeployment({
    deploymentId: params.deploymentId,
    appendToLists: {
      domainEvents: [params.event],
    },
  });
}

async function markJobRunning(params: {
  jobId: string;
  stage: AddDomainStage;
  extra?: Record<string, unknown>;
}): Promise<void> {
  await updateJob({
    jobId: params.jobId,
    set: {
      status: "RUNNING" as JobStatus,
      currentStage: params.stage,
      ...params.extra,
    },
  });
}

async function markJobFailed(params: {
  jobId: string;
  stage: AddDomainStage;
  error: unknown;
  extra?: Record<string, unknown>;
}): Promise<void> {
  const errorMessage = toErrorMessage(params.error);
  const errorDetails = toErrorDetails(params.error);

  await updateJob({
    jobId: params.jobId,
    set: {
      status: "FAILED" as JobStatus,
      currentStage: params.stage,
      lastError: errorMessage,
      lastErrorDetails: errorDetails,
      ...params.extra,
    },
  });
}

async function markJobSucceeded(params: {
  jobId: string;
  extra?: Record<string, unknown>;
}): Promise<void> {
  await updateJob({
    jobId: params.jobId,
    set: {
      status: "SUCCEEDED" as JobStatus,
      completedAt: nowIso(),
      ...params.extra,
    },
  });
}

async function runStage<T>(
  stages: AddDomainStageRecord[],
  stage: AddDomainStage,
  executor: () => Promise<T>,
  hooks?: {
    onStart?: () => Promise<void>;
    onSuccess?: (value: T) => Promise<void>;
    onFailure?: (error: unknown) => Promise<void>;
  }
): Promise<{ ok: true; value: T } | { ok: false; error: string; details?: unknown }> {
  const record = createStage(stage);
  stages.push(record);

  try {
    await hooks?.onStart?.();

    const value = await executor();

    record.status = "SUCCEEDED";
    record.completedAt = nowIso();
    record.details = value;

    await hooks?.onSuccess?.(value);

    return { ok: true, value };
  } catch (error) {
    record.status = "FAILED";
    record.completedAt = nowIso();
    record.error = toErrorMessage(error);
    record.details =
      error instanceof Error
        ? { message: error.message, stack: error.stack }
        : error;

    await hooks?.onFailure?.(error);

    return {
      ok: false,
      error: record.error,
      details: record.details,
    };
  }
}

async function loadOwnedDeployment(
  customerId: string,
  deploymentId: string
): Promise<DomainOwnershipCheckResult> {
  const deployment = await getDeploymentById(deploymentId);

  if (!deployment) {
    throw new Error(`Deployment ${deploymentId} not found`);
  }

  if (deployment.customerId !== customerId) {
    throw new Error(
      `Deployment ${deploymentId} does not belong to customer ${customerId}`
    );
  }

  if (!deployment.bucketName || typeof deployment.bucketName !== "string") {
    throw new Error(`Deployment ${deploymentId} has no bucketName`);
  }

  if (
    !deployment.cloudfrontDistributionId ||
    typeof deployment.cloudfrontDistributionId !== "string"
  ) {
    throw new Error(`Deployment ${deploymentId} has no cloudfrontDistributionId`);
  }

  return {
    customerId: deployment.customerId,
    deploymentId: deployment.id,
    bucketName: deployment.bucketName,
    cloudfrontDistributionId: deployment.cloudfrontDistributionId,
    cloudfrontDomainName:
      typeof deployment.cloudfrontDomainName === "string"
        ? deployment.cloudfrontDomainName
        : undefined,
    certificateArn:
      typeof deployment.certificateArn === "string"
        ? deployment.certificateArn
        : undefined,
    domains: Array.isArray(deployment.domains) ? deployment.domains : [],
  };
}

export async function addDomainToDeployment(
  params: AddDomainRequest
): Promise<AddDomainResult> {
  const stages: AddDomainStageRecord[] = [];
  const newRootDomain = ensureValidDomain(params.domain);
  const newDomainSet = toRootAndWwwDomains(newRootDomain);
  const startedAt = nowIso();
  const jobId = createId("job");

  let ownedDeployment: DomainOwnershipCheckResult | undefined;
  let certificateArn: string | undefined;
  let allDomains: string[] = [];
  let distributionId: string | undefined;
  let cloudFrontDomainName: string | undefined;
  let distributionArn: string | undefined;

  await putJob({
    id: jobId,
    jobId,
    customerId: params.customerId,
    deploymentId: params.deploymentId,
    jobType: "ADD_DOMAIN",
    status: "QUEUED",
    currentStage: "DOMAIN_CHECK",
    createdAt: startedAt,
    updatedAt: startedAt,
    payload: {
      domain: newRootDomain,
      domainsToAdd: newDomainSet,
    },
  });

  await updateDeployment({
    deploymentId: params.deploymentId,
    set: {
      status: "RUNNING" as DeploymentStatus,
      currentStage: "DOMAIN_CHECK",
      updatedAt: startedAt,
    },
    appendToLists: {
      domainEvents: [
        {
          type: "DOMAIN_ADD_STARTED",
          domain: newRootDomain,
          domainsApplied: newDomainSet,
          stage: "DOMAIN_CHECK",
          at: startedAt,
        } as DomainEvent,
      ],
    },
  });

  // 1. DOMAIN_CHECK
  {
    const result = await runStage(
      stages,
      "DOMAIN_CHECK",
      async () => {
        const domainCheck = await checkDomainAvailability(newRootDomain);

        if (!domainCheck.canProceed) {
          throw new Error(
            `Domain is not available for add-domain flow (${domainCheck.status})`
          );
        }

        return domainCheck;
      },
      {
        onStart: async () => {
          await Promise.all([
            markJobRunning({
              jobId,
              stage: "DOMAIN_CHECK",
            }),
            appendDomainEvent({
              deploymentId: params.deploymentId,
              event: {
                type: "DOMAIN_STAGE_STARTED",
                domain: newRootDomain,
                stage: "DOMAIN_CHECK",
                at: nowIso(),
              },
            }),
          ]);
        },
        onSuccess: async (value) => {
          await updateDeployment({
            deploymentId: params.deploymentId,
            set: {
              currentStage: "DOMAIN_CHECK",
              domainCheck: value,
            },
            appendToLists: {
              domainEvents: [
                {
                  type: "DOMAIN_STAGE_COMPLETED",
                  domain: newRootDomain,
                  stage: "DOMAIN_CHECK",
                  at: nowIso(),
                  details: {
                    status: value.status,
                  },
                } as DomainEvent,
              ],
            },
          });
        },
        onFailure: async (error) => {
          await Promise.all([
            markJobFailed({
              jobId,
              stage: "DOMAIN_CHECK",
              error,
            }),
            updateDeployment({
              deploymentId: params.deploymentId,
              set: {
                status: "FAILED" as DeploymentStatus,
                currentStage: "DOMAIN_CHECK",
                lastError: toErrorMessage(error),
                lastErrorDetails: toErrorDetails(error),
              },
              appendToLists: {
                domainEvents: [
                  {
                    type: "DOMAIN_ADD_FAILED",
                    domain: newRootDomain,
                    stage: "DOMAIN_CHECK",
                    message: toErrorMessage(error),
                    at: nowIso(),
                    details: toErrorDetails(error),
                  } as DomainEvent,
                ],
              },
            }),
          ]);
        },
      }
    );

    if (!result.ok) {
      return {
        success: false,
        stage: "DOMAIN_CHECK",
        error: result.error,
        details: {
          domain: newRootDomain,
          originalError: result.details,
        },
        stages,
      };
    }
  }

  // 2. DEPLOYMENT_LOOKUP
  {
    const result = await runStage(
      stages,
      "DEPLOYMENT_LOOKUP",
      async () => {
        const deployment = await loadOwnedDeployment(
          params.customerId,
          params.deploymentId
        );

        const lowerExistingDomains = deployment.domains.map((d) => d.toLowerCase());
        const conflicting = newDomainSet.find((d) =>
          lowerExistingDomains.includes(d.toLowerCase())
        );

        if (conflicting) {
          throw new Error(`Domain ${conflicting} is already attached to this deployment`);
        }

        ownedDeployment = deployment;

        return {
          deploymentId: deployment.deploymentId,
          existingDomains: deployment.domains,
          bucketName: deployment.bucketName,
          cloudfrontDistributionId: deployment.cloudfrontDistributionId,
        };
      },
      {
        onStart: async () => {
          await Promise.all([
            markJobRunning({
              jobId,
              stage: "DEPLOYMENT_LOOKUP",
            }),
            updateDeployment({
              deploymentId: params.deploymentId,
              set: {
                currentStage: "DEPLOYMENT_LOOKUP",
              },
              appendToLists: {
                domainEvents: [
                  {
                    type: "DOMAIN_STAGE_STARTED",
                    domain: newRootDomain,
                    stage: "DEPLOYMENT_LOOKUP",
                    at: nowIso(),
                  } as DomainEvent,
                ],
              },
            }),
          ]);
        },
        onSuccess: async (value) => {
          await updateDeployment({
            deploymentId: params.deploymentId,
            set: {
              currentStage: "DEPLOYMENT_LOOKUP",
              domainLookup: value,
            },
            appendToLists: {
              domainEvents: [
                {
                  type: "DOMAIN_STAGE_COMPLETED",
                  domain: newRootDomain,
                  stage: "DEPLOYMENT_LOOKUP",
                  at: nowIso(),
                } as DomainEvent,
              ],
            },
          });
        },
        onFailure: async (error) => {
          await Promise.all([
            markJobFailed({
              jobId,
              stage: "DEPLOYMENT_LOOKUP",
              error,
            }),
            updateDeployment({
              deploymentId: params.deploymentId,
              set: {
                status: "FAILED" as DeploymentStatus,
                currentStage: "DEPLOYMENT_LOOKUP",
                lastError: toErrorMessage(error),
                lastErrorDetails: toErrorDetails(error),
              },
              appendToLists: {
                domainEvents: [
                  {
                    type: "DOMAIN_ADD_FAILED",
                    domain: newRootDomain,
                    stage: "DEPLOYMENT_LOOKUP",
                    message: toErrorMessage(error),
                    at: nowIso(),
                    details: toErrorDetails(error),
                  } as DomainEvent,
                ],
              },
            }),
          ]);
        },
      }
    );

    if (!result.ok) {
      return {
        success: false,
        stage: "DEPLOYMENT_LOOKUP",
        error: result.error,
        details: {
          deploymentId: params.deploymentId,
          customerId: params.customerId,
          originalError: result.details,
        },
        stages,
      };
    }
  }

  // 3. ACM_REQUEST
  {
    const result = await runStage(
      stages,
      "ACM_REQUEST",
      async () => {
        if (!ownedDeployment) {
          throw new Error("Owned deployment missing before ACM request");
        }

        const existingRootDomains = ownedDeployment.domains
          .filter((d) => !d.startsWith("www."))
          .map((d) => d.toLowerCase());

        const mergedRootDomains = [
          ...new Set([...existingRootDomains, newRootDomain.toLowerCase()]),
        ];

        const primaryDomain = mergedRootDomains[0];

        const uniqueSans = [
          ...new Set(
            mergedRootDomains.flatMap((domain) => {
              const certificateDomains = buildCertificateDomains(domain);

              return [
                certificateDomains.rootDomain,
                ...certificateDomains.subjectAlternativeNames,
              ];
            })
          ),
        ].filter((domain) => domain !== primaryDomain);

        certificateArn = await requestCertificate(primaryDomain, uniqueSans);

        return {
          certificateArn,
          primaryDomain,
          subjectAlternativeNames: uniqueSans,
        };
      },
      {
        onStart: async () => {
          await Promise.all([
            markJobRunning({
              jobId,
              stage: "ACM_REQUEST",
            }),
            updateDeployment({
              deploymentId: params.deploymentId,
              set: {
                currentStage: "ACM_REQUEST",
              },
              appendToLists: {
                domainEvents: [
                  {
                    type: "DOMAIN_STAGE_STARTED",
                    domain: newRootDomain,
                    stage: "ACM_REQUEST",
                    at: nowIso(),
                  } as DomainEvent,
                ],
              },
            }),
          ]);
        },
        onSuccess: async (value) => {
          await updateDeployment({
            deploymentId: params.deploymentId,
            set: {
              currentStage: "ACM_REQUEST",
              pendingCertificateArn: value.certificateArn,
            },
            appendToLists: {
              domainEvents: [
                {
                  type: "DOMAIN_STAGE_COMPLETED",
                  domain: newRootDomain,
                  stage: "ACM_REQUEST",
                  at: nowIso(),
                  details: value,
                } as DomainEvent,
              ],
            },
          });
        },
        onFailure: async (error) => {
          await Promise.all([
            markJobFailed({
              jobId,
              stage: "ACM_REQUEST",
              error,
            }),
            updateDeployment({
              deploymentId: params.deploymentId,
              set: {
                status: "FAILED" as DeploymentStatus,
                currentStage: "ACM_REQUEST",
                lastError: toErrorMessage(error),
                lastErrorDetails: toErrorDetails(error),
              },
              appendToLists: {
                domainEvents: [
                  {
                    type: "DOMAIN_ADD_FAILED",
                    domain: newRootDomain,
                    stage: "ACM_REQUEST",
                    message: toErrorMessage(error),
                    at: nowIso(),
                    details: toErrorDetails(error),
                  } as DomainEvent,
                ],
              },
            }),
          ]);
        },
      }
    );

    if (!result.ok) {
      return {
        success: false,
        stage: "ACM_REQUEST",
        error: result.error,
        details: {
          domain: newRootDomain,
          originalError: result.details,
        },
        stages,
      };
    }
  }

  // 4. ACM_VALIDATION_RECORDS
  {
    const result = await runStage(
      stages,
      "ACM_VALIDATION_RECORDS",
      async () => {
        if (!certificateArn) {
          throw new Error("certificateArn missing before validation records");
        }

        const validationRecords = await getCertificateValidationRecords(certificateArn);
        const appliedRecords: Array<{
          name: string;
          type: string;
          hostedZoneId: string;
          upserted: true;
        }> = [];

        for (const record of validationRecords) {
          const applied = await upsertDnsValidationRecord(
            record.name,
            record.type,
            record.value
          );
          appliedRecords.push(applied);
        }

        return {
          certificateArn,
          recordCount: validationRecords.length,
          appliedRecords,
        };
      },
      {
        onStart: async () => {
          await Promise.all([
            markJobRunning({
              jobId,
              stage: "ACM_VALIDATION_RECORDS",
            }),
            updateDeployment({
              deploymentId: params.deploymentId,
              set: {
                currentStage: "ACM_VALIDATION_RECORDS",
              },
              appendToLists: {
                domainEvents: [
                  {
                    type: "DOMAIN_STAGE_STARTED",
                    domain: newRootDomain,
                    stage: "ACM_VALIDATION_RECORDS",
                    at: nowIso(),
                  } as DomainEvent,
                ],
              },
            }),
          ]);
        },
        onSuccess: async (value) => {
          await updateDeployment({
            deploymentId: params.deploymentId,
            set: {
              currentStage: "ACM_VALIDATION_RECORDS",
              certificateValidationSummary: value,
            },
            appendToLists: {
              domainEvents: [
                {
                  type: "DOMAIN_STAGE_COMPLETED",
                  domain: newRootDomain,
                  stage: "ACM_VALIDATION_RECORDS",
                  at: nowIso(),
                  details: value,
                } as DomainEvent,
              ],
            },
          });
        },
        onFailure: async (error) => {
          await Promise.all([
            markJobFailed({
              jobId,
              stage: "ACM_VALIDATION_RECORDS",
              error,
            }),
            updateDeployment({
              deploymentId: params.deploymentId,
              set: {
                status: "FAILED" as DeploymentStatus,
                currentStage: "ACM_VALIDATION_RECORDS",
                lastError: toErrorMessage(error),
                lastErrorDetails: toErrorDetails(error),
              },
              appendToLists: {
                domainEvents: [
                  {
                    type: "DOMAIN_ADD_FAILED",
                    domain: newRootDomain,
                    stage: "ACM_VALIDATION_RECORDS",
                    message: toErrorMessage(error),
                    at: nowIso(),
                    details: toErrorDetails(error),
                  } as DomainEvent,
                ],
              },
            }),
          ]);
        },
      }
    );

    if (!result.ok) {
      return {
        success: false,
        stage: "ACM_VALIDATION_RECORDS",
        error: result.error,
        details: {
          certificateArn,
          originalError: result.details,
        },
        stages,
      };
    }
  }

  // 5. ACM_WAIT
  {
    const result = await runStage(
      stages,
      "ACM_WAIT",
      async () => {
        if (!certificateArn) {
          throw new Error("certificateArn missing before ACM wait");
        }

        await waitForCertificateIssued(certificateArn);

        return {
          certificateArn,
          status: "ISSUED",
        };
      },
      {
        onStart: async () => {
          await Promise.all([
            markJobRunning({
              jobId,
              stage: "ACM_WAIT",
            }),
            updateDeployment({
              deploymentId: params.deploymentId,
              set: {
                currentStage: "ACM_WAIT",
              },
              appendToLists: {
                domainEvents: [
                  {
                    type: "DOMAIN_STAGE_STARTED",
                    domain: newRootDomain,
                    stage: "ACM_WAIT",
                    at: nowIso(),
                  } as DomainEvent,
                ],
              },
            }),
          ]);
        },
        onSuccess: async (value) => {
          await updateDeployment({
            deploymentId: params.deploymentId,
            set: {
              currentStage: "ACM_WAIT",
              certificateStatus: value.status,
            },
            appendToLists: {
              domainEvents: [
                {
                  type: "DOMAIN_STAGE_COMPLETED",
                  domain: newRootDomain,
                  stage: "ACM_WAIT",
                  at: nowIso(),
                  details: value,
                } as DomainEvent,
              ],
            },
          });
        },
        onFailure: async (error) => {
          await Promise.all([
            markJobFailed({
              jobId,
              stage: "ACM_WAIT",
              error,
            }),
            updateDeployment({
              deploymentId: params.deploymentId,
              set: {
                status: "FAILED" as DeploymentStatus,
                currentStage: "ACM_WAIT",
                lastError: toErrorMessage(error),
                lastErrorDetails: toErrorDetails(error),
              },
              appendToLists: {
                domainEvents: [
                  {
                    type: "DOMAIN_ADD_FAILED",
                    domain: newRootDomain,
                    stage: "ACM_WAIT",
                    message: toErrorMessage(error),
                    at: nowIso(),
                    details: toErrorDetails(error),
                  } as DomainEvent,
                ],
              },
            }),
          ]);
        },
      }
    );

    if (!result.ok) {
      return {
        success: false,
        stage: "ACM_WAIT",
        error: result.error,
        details: {
          certificateArn,
          originalError: result.details,
        },
        stages,
      };
    }
  }

  // 6. CLOUDFRONT_UPDATE
  {
    const result = await runStage(
      stages,
      "CLOUDFRONT_UPDATE",
      async () => {
        if (!ownedDeployment) {
          throw new Error("Owned deployment missing before CloudFront update");
        }

        if (!certificateArn) {
          throw new Error("certificateArn missing before CloudFront update");
        }

        allDomains = [...new Set([...ownedDeployment.domains, ...newDomainSet])].sort();

        const distribution = await createDistribution({
          bucketRegionalDomainName: buildBucketRegionalDomainName(
            ownedDeployment.bucketName
          ),
          domainNames: allDomains,
          certificateArn,
        });

        await ensureCloudFrontReadAccess({
          bucketName: ownedDeployment.bucketName,
          distributionArn: distribution.arn,
        });

        distributionId = distribution.distributionId;
        cloudFrontDomainName = distribution.domainName;
        distributionArn = distribution.arn;

        return {
          distributionId,
          cloudFrontDomainName,
          distributionArn,
          allDomains,
        };
      },
      {
        onStart: async () => {
          await Promise.all([
            markJobRunning({
              jobId,
              stage: "CLOUDFRONT_UPDATE",
            }),
            updateDeployment({
              deploymentId: params.deploymentId,
              set: {
                currentStage: "CLOUDFRONT_UPDATE",
              },
              appendToLists: {
                domainEvents: [
                  {
                    type: "DOMAIN_STAGE_STARTED",
                    domain: newRootDomain,
                    stage: "CLOUDFRONT_UPDATE",
                    at: nowIso(),
                  } as DomainEvent,
                ],
              },
            }),
          ]);
        },
        onSuccess: async (value) => {
          await updateDeployment({
            deploymentId: params.deploymentId,
            set: {
              currentStage: "CLOUDFRONT_UPDATE",
              cloudfrontDistributionId: value.distributionId,
              cloudfrontDomainName: value.cloudFrontDomainName,
              certificateArn,
              domains: value.allDomains,
            },
            appendToLists: {
              domainEvents: [
                {
                  type: "DOMAIN_STAGE_COMPLETED",
                  domain: newRootDomain,
                  stage: "CLOUDFRONT_UPDATE",
                  at: nowIso(),
                  details: value,
                } as DomainEvent,
              ],
            },
          });
        },
        onFailure: async (error) => {
          await Promise.all([
            markJobFailed({
              jobId,
              stage: "CLOUDFRONT_UPDATE",
              error,
            }),
            updateDeployment({
              deploymentId: params.deploymentId,
              set: {
                status: "FAILED" as DeploymentStatus,
                currentStage: "CLOUDFRONT_UPDATE",
                lastError: toErrorMessage(error),
                lastErrorDetails: toErrorDetails(error),
              },
              appendToLists: {
                domainEvents: [
                  {
                    type: "DOMAIN_ADD_FAILED",
                    domain: newRootDomain,
                    stage: "CLOUDFRONT_UPDATE",
                    message: toErrorMessage(error),
                    at: nowIso(),
                    details: toErrorDetails(error),
                  } as DomainEvent,
                ],
              },
            }),
          ]);
        },
      }
    );

    if (!result.ok) {
      return {
        success: false,
        stage: "CLOUDFRONT_UPDATE",
        error: result.error,
        details: {
          certificateArn,
          deploymentId: params.deploymentId,
          originalError: result.details,
        },
        stages,
      };
    }
  }

  // 7. ROUTE53_ALIAS
  {
    const result = await runStage(
      stages,
      "ROUTE53_ALIAS",
      async () => {
        if (!cloudFrontDomainName) {
          throw new Error(
            "cloudFrontDomainName missing before Route53 alias update"
          );
        }

        const aliasResult = await upsertCloudFrontAliasRecords(
          newDomainSet,
          cloudFrontDomainName
        );

        return {
          newDomains: newDomainSet,
          cloudFrontDomainName,
          aliasResult,
        };
      },
      {
        onStart: async () => {
          await Promise.all([
            markJobRunning({
              jobId,
              stage: "ROUTE53_ALIAS",
            }),
            updateDeployment({
              deploymentId: params.deploymentId,
              set: {
                currentStage: "ROUTE53_ALIAS",
              },
              appendToLists: {
                domainEvents: [
                  {
                    type: "DOMAIN_STAGE_STARTED",
                    domain: newRootDomain,
                    stage: "ROUTE53_ALIAS",
                    at: nowIso(),
                  } as DomainEvent,
                ],
              },
            }),
          ]);
        },
        onSuccess: async (value) => {
          await updateDeployment({
            deploymentId: params.deploymentId,
            set: {
              currentStage: "ROUTE53_ALIAS",
            },
            appendToLists: {
              domainEvents: [
                {
                  type: "DOMAIN_STAGE_COMPLETED",
                  domain: newRootDomain,
                  stage: "ROUTE53_ALIAS",
                  at: nowIso(),
                  details: value,
                } as DomainEvent,
              ],
            },
          });
        },
        onFailure: async (error) => {
          await Promise.all([
            markJobFailed({
              jobId,
              stage: "ROUTE53_ALIAS",
              error,
            }),
            updateDeployment({
              deploymentId: params.deploymentId,
              set: {
                status: "FAILED" as DeploymentStatus,
                currentStage: "ROUTE53_ALIAS",
                lastError: toErrorMessage(error),
                lastErrorDetails: toErrorDetails(error),
              },
              appendToLists: {
                domainEvents: [
                  {
                    type: "DOMAIN_ADD_FAILED",
                    domain: newRootDomain,
                    stage: "ROUTE53_ALIAS",
                    message: toErrorMessage(error),
                    at: nowIso(),
                    details: toErrorDetails(error),
                  } as DomainEvent,
                ],
              },
            }),
          ]);
        },
      }
    );

    if (!result.ok) {
      return {
        success: false,
        stage: "ROUTE53_ALIAS",
        error: result.error,
        details: {
          newDomains: newDomainSet,
          cloudFrontDomainName,
          originalError: result.details,
        },
        stages,
      };
    }
  }

  // 8. DYNAMODB
  {
    const result = await runStage(
      stages,
      "DYNAMODB",
      async () => {
        if (!ownedDeployment) {
          throw new Error("Owned deployment missing before persistence");
        }

        if (!distributionId) {
          throw new Error("distributionId missing before persistence");
        }

        await updateDeployment({
          deploymentId: ownedDeployment.deploymentId,
          set: {
            status: "SUCCEEDED" as DeploymentStatus,
            currentStage: "DYNAMODB",
            bucketName: ownedDeployment.bucketName,
            cloudfrontDistributionId: distributionId,
            cloudfrontDomainName: cloudFrontDomainName,
            certificateArn,
            domains: allDomains,
          },
          appendToLists: {
            domainEvents: [
              {
                type: "DOMAIN_ADDED",
                domain: newRootDomain,
                domainsApplied: newDomainSet,
                stage: "DYNAMODB",
                at: nowIso(),
                details: {
                  distributionId,
                  cloudFrontDomainName,
                  certificateArn,
                },
              } as DomainEvent,
            ],
          },
          remove: ["pendingCertificateArn"],
        });

        return {
          deploymentId: ownedDeployment.deploymentId,
          domains: allDomains,
          certificateArn,
        };
      },
      {
        onStart: async () => {
          await markJobRunning({
            jobId,
            stage: "DYNAMODB",
          });
        },
        onSuccess: async (value) => {
          await Promise.all([
            markJobSucceeded({
              jobId,
              extra: {
                currentStage: "DYNAMODB",
                payload: {
                  deploymentId: params.deploymentId,
                  addedDomain: newRootDomain,
                  allDomains: value.domains,
                  certificateArn: value.certificateArn,
                },
              },
            }),
            updateDeployment({
              deploymentId: params.deploymentId,
              appendToLists: {
                domainEvents: [
                  {
                    type: "DOMAIN_STAGE_COMPLETED",
                    domain: newRootDomain,
                    stage: "DYNAMODB",
                    at: nowIso(),
                    details: value,
                  } as DomainEvent,
                ],
              },
            }),
          ]);
        },
        onFailure: async (error) => {
          await Promise.all([
            markJobFailed({
              jobId,
              stage: "DYNAMODB",
              error,
            }),
            updateDeployment({
              deploymentId: params.deploymentId,
              set: {
                status: "FAILED" as DeploymentStatus,
                currentStage: "DYNAMODB",
                lastError: toErrorMessage(error),
                lastErrorDetails: toErrorDetails(error),
              },
              appendToLists: {
                domainEvents: [
                  {
                    type: "DOMAIN_ADD_FAILED",
                    domain: newRootDomain,
                    stage: "DYNAMODB",
                    message: toErrorMessage(error),
                    at: nowIso(),
                    details: toErrorDetails(error),
                  } as DomainEvent,
                ],
              },
            }),
          ]);
        },
      }
    );

    if (!result.ok) {
      return {
        success: false,
        stage: "DYNAMODB",
        error: result.error,
        details: {
          deploymentId: params.deploymentId,
          originalError: result.details,
        },
        stages,
      };
    }
  }

  return {
    success: true,
    deploymentId: params.deploymentId,
    domain: newRootDomain,
    allDomains,
    certificateArn: certificateArn!,
    distributionId: distributionId!,
    cloudFrontDomainName,
    stages,
  };
}