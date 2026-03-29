import {
    ensureValidDomain,
    buildCertificateDomains,
    toRootAndWwwDomains
  } from '../../utils/domain.util';
  import { checkDomainAvailability } from './domain-check.service';
  import {
    requestCertificate,
    getCertificateValidationRecords,
    waitForCertificateIssued
  } from '../aws/acm.service';
  import { upsertDnsValidationRecord, upsertCloudFrontAliasRecords } from '../aws/route53.service';
  import { createDistribution } from '../aws/cloudfront.service';
  import { buildBucketRegionalDomainName, ensureCloudFrontReadAccess } from '../aws/s3.service';
  import { getDeploymentById, putDeployment } from '../aws/dynamodb.service';
  import type {
    AddDomainRequest,
    AddDomainResult,
    AddDomainStage,
    AddDomainStageRecord,
    DomainOwnershipCheckResult
  } from './domain.types';
  
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
  
  function createStage(stage: AddDomainStage): AddDomainStageRecord {
    return {
      stage,
      status: 'IN_PROGRESS',
      startedAt: nowIso()
    };
  }
  
  async function runStage<T>(
    stages: AddDomainStageRecord[],
    stage: AddDomainStage,
    executor: () => Promise<T>
  ): Promise<{ ok: true; value: T } | { ok: false; error: string; details?: unknown }> {
    const record = createStage(stage);
    stages.push(record);
  
    try {
      const value = await executor();
      record.status = 'SUCCEEDED';
      record.completedAt = nowIso();
      record.details = value;
      return { ok: true, value };
    } catch (error) {
      record.status = 'FAILED';
      record.completedAt = nowIso();
      record.error = toErrorMessage(error);
      record.details = error instanceof Error ? { message: error.message, stack: error.stack } : error;
  
      return {
        ok: false,
        error: record.error,
        details: record.details
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
      throw new Error(`Deployment ${deploymentId} does not belong to customer ${customerId}`);
    }
  
    if (!deployment.bucketName) {
      throw new Error(`Deployment ${deploymentId} has no bucketName`);
    }
  
    if (!deployment.cloudfrontDistributionId) {
      throw new Error(`Deployment ${deploymentId} has no cloudfrontDistributionId`);
    }
  
    return {
      customerId: deployment.customerId,
      deploymentId: deployment.id,
      bucketName: deployment.bucketName,
      cloudfrontDistributionId: deployment.cloudfrontDistributionId,
      cloudfrontDomainName: deployment.cloudfrontDomainName,
      certificateArn: deployment.certificateArn,
      domains: Array.isArray(deployment.domains) ? deployment.domains : []
    };
  }
  
  export async function addDomainToDeployment(
    params: AddDomainRequest
  ): Promise<AddDomainResult> {
    const stages: AddDomainStageRecord[] = [];
    const newRootDomain = ensureValidDomain(params.domain);
    const newDomainSet = toRootAndWwwDomains(newRootDomain);
  
    let ownedDeployment: DomainOwnershipCheckResult | undefined;
    let certificateArn: string | undefined;
  
    // 1. DOMAIN_CHECK
    {
      const result = await runStage(stages, 'DOMAIN_CHECK', async () => {
        const domainCheck = await checkDomainAvailability(newRootDomain);
  
        if (!domainCheck.canProceed) {
          throw new Error(`Domain is not available for add-domain flow (${domainCheck.status})`);
        }
  
        return domainCheck;
      });
  
      if (!result.ok) {
        return {
          success: false,
          stage: 'DOMAIN_CHECK',
          error: result.error,
          details: {
            domain: newRootDomain,
            originalError: result.details
          },
          stages
        };
      }
    }
  
    // 2. DEPLOYMENT_LOOKUP
    {
      const result = await runStage(stages, 'DEPLOYMENT_LOOKUP', async () => {
        const deployment = await loadOwnedDeployment(params.customerId, params.deploymentId);
  
        const lowerExistingDomains = deployment.domains.map((d) => d.toLowerCase());
        const conflicting = newDomainSet.find((d) => lowerExistingDomains.includes(d.toLowerCase()));
  
        if (conflicting) {
          throw new Error(`Domain ${conflicting} is already attached to this deployment`);
        }
  
        ownedDeployment = deployment;
  
        return {
          deploymentId: deployment.deploymentId,
          existingDomains: deployment.domains,
          bucketName: deployment.bucketName,
          cloudfrontDistributionId: deployment.cloudfrontDistributionId
        };
      });
  
      if (!result.ok) {
        return {
          success: false,
          stage: 'DEPLOYMENT_LOOKUP',
          error: result.error,
          details: {
            deploymentId: params.deploymentId,
            customerId: params.customerId,
            originalError: result.details
          },
          stages
        };
      }
    }
  
    // 3. ACM_REQUEST
    {
      const result = await runStage(stages, 'ACM_REQUEST', async () => {
        if (!ownedDeployment) {
          throw new Error('Owned deployment missing before ACM request');
        }
  
        const existingRootDomains = ownedDeployment.domains
          .filter((d) => !d.startsWith('www.'))
          .map((d) => d.toLowerCase());
  
        const mergedRootDomains = [...new Set([...existingRootDomains, newRootDomain.toLowerCase()])];
  
        const primaryDomain = mergedRootDomains[0];
        const sans = mergedRootDomains.flatMap((domain) => buildCertificateDomains(domain).subjectAlternativeNames.concat(domain));
  
        const uniqueSans = [...new Set(sans)].filter((domain) => domain !== primaryDomain);
  
        certificateArn = await requestCertificate(primaryDomain, uniqueSans);
  
        return {
          certificateArn,
          primaryDomain,
          subjectAlternativeNames: uniqueSans
        };
      });
  
      if (!result.ok) {
        return {
          success: false,
          stage: 'ACM_REQUEST',
          error: result.error,
          details: {
            domain: newRootDomain,
            originalError: result.details
          },
          stages
        };
      }
    }
  
    // 4. ACM_VALIDATION_RECORDS
    {
      const result = await runStage(stages, 'ACM_VALIDATION_RECORDS', async () => {
        if (!certificateArn) {
          throw new Error('certificateArn missing before validation records');
        }
  
        const validationRecords = await getCertificateValidationRecords(certificateArn);
  
        for (const record of validationRecords) {
          await upsertDnsValidationRecord(record.name, record.type, record.value);
        }
  
        return {
          certificateArn,
          recordCount: validationRecords.length
        };
      });
  
      if (!result.ok) {
        return {
          success: false,
          stage: 'ACM_VALIDATION_RECORDS',
          error: result.error,
          details: {
            certificateArn,
            originalError: result.details
          },
          stages
        };
      }
    }
  
    // 5. ACM_WAIT
    {
      const result = await runStage(stages, 'ACM_WAIT', async () => {
        if (!certificateArn) {
          throw new Error('certificateArn missing before ACM wait');
        }
  
        await waitForCertificateIssued(certificateArn);
  
        return {
          certificateArn,
          status: 'ISSUED'
        };
      });
  
      if (!result.ok) {
        return {
          success: false,
          stage: 'ACM_WAIT',
          error: result.error,
          details: {
            certificateArn,
            originalError: result.details
          },
          stages
        };
      }
    }
  
    // 6. CLOUDFRONT_UPDATE
    let allDomains: string[] = [];
    let distributionId: string | undefined;
    let cloudFrontDomainName: string | undefined;
    let distributionArn: string | undefined;
  
    {
      const result = await runStage(stages, 'CLOUDFRONT_UPDATE', async () => {
        if (!ownedDeployment) {
          throw new Error('Owned deployment missing before CloudFront update');
        }
  
        if (!certificateArn) {
          throw new Error('certificateArn missing before CloudFront update');
        }
  
        allDomains = [...new Set([...ownedDeployment.domains, ...newDomainSet])].sort();
  
        const distribution = await createDistribution({
          bucketRegionalDomainName: buildBucketRegionalDomainName(ownedDeployment.bucketName),
          domainNames: allDomains,
          certificateArn
        });
  
        await ensureCloudFrontReadAccess({
          bucketName: ownedDeployment.bucketName,
          distributionArn: distribution.arn
        });
  
        distributionId = distribution.distributionId;
        cloudFrontDomainName = distribution.domainName;
        distributionArn = distribution.arn;
  
        return {
          distributionId,
          cloudFrontDomainName,
          distributionArn,
          allDomains
        };
      });
  
      if (!result.ok) {
        return {
          success: false,
          stage: 'CLOUDFRONT_UPDATE',
          error: result.error,
          details: {
            certificateArn,
            deploymentId: params.deploymentId,
            originalError: result.details
          },
          stages
        };
      }
    }
  
    // 7. ROUTE53_ALIAS
    {
      const result = await runStage(stages, 'ROUTE53_ALIAS', async () => {
        if (!cloudFrontDomainName) {
          throw new Error('cloudFrontDomainName missing before Route53 alias update');
        }
  
        await upsertCloudFrontAliasRecords(newDomainSet, cloudFrontDomainName);
  
        return {
          newDomains: newDomainSet,
          cloudFrontDomainName
        };
      });
  
      if (!result.ok) {
        return {
          success: false,
          stage: 'ROUTE53_ALIAS',
          error: result.error,
          details: {
            newDomains: newDomainSet,
            cloudFrontDomainName,
            originalError: result.details
          },
          stages
        };
      }
    }
  
    // 8. DYNAMODB
    {
      const result = await runStage(stages, 'DYNAMODB', async () => {
        if (!ownedDeployment) {
          throw new Error('Owned deployment missing before persistence');
        }
  
        if (!distributionId) {
          throw new Error('distributionId missing before persistence');
        }
  
        await putDeployment({
          id: ownedDeployment.deploymentId,
          customerId: ownedDeployment.customerId,
          deploymentType: 'INITIAL_DEPLOY',
          status: 'SUCCEEDED',
          currentStage: 'DYNAMODB',
          bucketName: ownedDeployment.bucketName,
          cloudfrontDistributionId: distributionId,
          cloudfrontDomainName: cloudFrontDomainName,
          certificateArn,
          domains: allDomains,
          updatedAt: nowIso(),
          domainEvents: [
            {
              type: 'DOMAIN_ADDED',
              domain: newRootDomain,
              domainsApplied: newDomainSet,
              at: nowIso()
            }
          ]
        });
  
        return {
          deploymentId: ownedDeployment.deploymentId,
          domains: allDomains,
          certificateArn
        };
      });
  
      if (!result.ok) {
        return {
          success: false,
          stage: 'DYNAMODB',
          error: result.error,
          details: {
            deploymentId: params.deploymentId,
            originalError: result.details
          },
          stages
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
      stages
    };
  }