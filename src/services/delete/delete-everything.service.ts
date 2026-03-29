import crypto from 'node:crypto';
import {
    getDeploymentById,
    putDeployment,
    putJob,
    type DeploymentRecord
} from '../aws/dynamodb.service';
import { queueJob } from '../aws/sqs.service';
import { removeCloudFrontAliasRecords } from '../aws/route53.service';
import { disableAndDeleteDistribution } from '../aws/cloudfront.service';
import { removeCloudFrontReadAccess, emptyAndDeleteBucket } from '../aws/s3.service';
import { deleteCertificateIfExists } from '../aws/acm.service';

type DeleteEverythingStage =
    | 'DEPLOYMENT_LOOKUP'
    | 'CONFIRM_CHECK'
    | 'ROUTE53_DELETE'
    | 'CLOUDFRONT_DELETE'
    | 'S3_POLICY_DELETE'
    | 'S3_BUCKET_DELETE'
    | 'ACM_DELETE'
    | 'DYNAMODB'
    | 'SQS';

type StageStatus = 'PENDING' | 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED';

type DeleteEverythingStageRecord = {
    stage: DeleteEverythingStage;
    status: StageStatus;
    startedAt: string;
    completedAt?: string;
    error?: string;
    details?: unknown;
};

type DeleteEverythingParams = {
    customerId: string;
    deploymentId: string;
    confirm: boolean;
};

type DeleteEverythingFailure = {
    success: false;
    stage: DeleteEverythingStage;
    error: string;
    details?: unknown;
    deploymentId: string;
    jobId: string;
    stages: DeleteEverythingStageRecord[];
};

type DeleteEverythingSuccess = {
    success: true;
    deploymentId: string;
    jobId: string;
    customerId: string;
    deleted: {
        route53: boolean;
        cloudfront: boolean;
        s3Policy: boolean;
        s3Bucket: boolean;
        acm: boolean;
    };
    stages: DeleteEverythingStageRecord[];
};

export type DeleteEverythingResult =
    | DeleteEverythingFailure
    | DeleteEverythingSuccess;

type RuntimeState = {
    deploymentId: string;
    jobId: string;
    customerId: string;
    confirm: boolean;
    stages: DeleteEverythingStageRecord[];
    deployment?: DeploymentRecord;
    deleted: {
        route53: boolean;
        cloudfront: boolean;
        s3Policy: boolean;
        s3Bucket: boolean;
        acm: boolean;
    };
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

function createStage(stage: DeleteEverythingStage): DeleteEverythingStageRecord {
    return {
        stage,
        status: 'IN_PROGRESS',
        startedAt: nowIso()
    };
}

async function runStage<T>(
    state: RuntimeState,
    stage: DeleteEverythingStage,
    executor: () => Promise<T>
): Promise<{ ok: true; value: T } | { ok: false; failure: DeleteEverythingFailure }> {
    const record = createStage(stage);
    state.stages.push(record);

    try {
        const value = await executor();
        record.status = 'SUCCEEDED';
        record.completedAt = nowIso();
        record.details = value;

        return {
            ok: true,
            value
        };
    } catch (error) {
        record.status = 'FAILED';
        record.completedAt = nowIso();
        record.error = toErrorMessage(error);
        record.details = toSerializableError(error);

        return {
            ok: false,
            failure: {
                success: false,
                stage,
                error: record.error,
                details: record.details,
                deploymentId: state.deploymentId,
                jobId: state.jobId,
                stages: state.stages
            }
        };
    }
}

async function persistFailureState(
    state: RuntimeState,
    failedStage: DeleteEverythingStage,
    failure: DeleteEverythingFailure
): Promise<void> {
    const timestamp = nowIso();

    try {
        if (state.deployment) {
            await putDeployment({
                ...state.deployment,
                id: state.deployment.id,
                customerId: state.deployment.customerId,
                status: 'FAILED',
                currentStage: failedStage,
                updatedAt: timestamp,
                lastError: failure.error,
                lastErrorDetails: failure.details,
                deletionEvents: [
                    ...((Array.isArray(state.deployment.deletionEvents)
                        ? state.deployment.deletionEvents
                        : []) as unknown[]),
                    {
                        type: 'DELETE_EVERYTHING_FAILED',
                        failedStage,
                        deleted: state.deleted,
                        at: timestamp
                    }
                ]
            });
        }
    } catch (error) {
        console.error('[DELETE_EVERYTHING] Failed to persist deployment failure state', {
            deploymentId: state.deploymentId,
            failedStage,
            error: toErrorMessage(error)
        });
    }

    try {
        await putJob({
            id: state.jobId,
            customerId: state.customerId,
            deploymentId: state.deploymentId,
            jobType: 'DELETE_EVERYTHING',
            status: 'FAILED',
            payload: {
                failedStage,
                deleted: state.deleted
            },
            stages: state.stages,
            lastError: failure.error,
            lastErrorDetails: failure.details,
            createdAt: timestamp,
            updatedAt: timestamp
        });
    } catch (error) {
        console.error('[DELETE_EVERYTHING] Failed to persist job failure state', {
            jobId: state.jobId,
            failedStage,
            error: toErrorMessage(error)
        });
    }
}

export async function deleteEverything(
    params: DeleteEverythingParams
): Promise<DeleteEverythingResult> {
    const state: RuntimeState = {
        deploymentId: params.deploymentId,
        jobId: crypto.randomUUID(),
        customerId: params.customerId,
        confirm: params.confirm,
        stages: [],
        deleted: {
            route53: false,
            cloudfront: false,
            s3Policy: false,
            s3Bucket: false,
            acm: false
        }
    };

    // 1. DEPLOYMENT_LOOKUP
    {
        const result = await runStage(state, 'DEPLOYMENT_LOOKUP', async () => {
            const deployment = await getDeploymentById(params.deploymentId);

            if (!deployment) {
                throw new Error(`Deployment ${params.deploymentId} not found`);
            }

            if (deployment.customerId !== params.customerId) {
                throw new Error(
                    `Deployment ${params.deploymentId} does not belong to customer ${params.customerId}`
                );
            }

            if (!deployment.bucketName) {
                throw new Error(`Deployment ${params.deploymentId} has no bucketName`);
            }

            state.deployment = deployment;

            return {
                deploymentId: deployment.id,
                customerId: deployment.customerId,
                bucketName: deployment.bucketName,
                cloudfrontDistributionId: deployment.cloudfrontDistributionId ?? null,
                certificateArn: deployment.certificateArn ?? null,
                domains: Array.isArray(deployment.domains) ? deployment.domains : []
            };
        });

        if (!result.ok) {
            await persistFailureState(state, 'DEPLOYMENT_LOOKUP', result.failure);
            return result.failure;
        }
    }

    // 2. CONFIRM_CHECK
    {
        const result = await runStage(state, 'CONFIRM_CHECK', async () => {
            if (!params.confirm) {
                throw new Error('Explicit confirm=true is required for delete-everything');
            }

            return {
                confirm: true
            };
        });

        if (!result.ok) {
            await persistFailureState(state, 'CONFIRM_CHECK', result.failure);
            return result.failure;
        }
    }

    // 3. ROUTE53_DELETE
    {
        const result = await runStage(state, 'ROUTE53_DELETE', async () => {
            if (!state.deployment) {
                throw new Error('deployment missing before Route53 delete');
            }

            const domains = Array.isArray(state.deployment.domains)
                ? state.deployment.domains.map((d) => String(d))
                : [];

            if (!domains.length) {
                return {
                    skipped: true,
                    reason: 'No domains on deployment'
                };
            }

            await removeCloudFrontAliasRecords(domains);

            state.deleted.route53 = true;

            return {
                domainsRemoved: domains
            };
        });

        if (!result.ok) {
            await persistFailureState(state, 'ROUTE53_DELETE', result.failure);
            return result.failure;
        }
    }

    // 4. CLOUDFRONT_DELETE
    {
        const result = await runStage(state, 'CLOUDFRONT_DELETE', async () => {
            if (!state.deployment) {
                throw new Error('deployment missing before CloudFront delete');
            }

            if (!state.deployment.cloudfrontDistributionId) {
                return {
                    skipped: true,
                    reason: 'No cloudfrontDistributionId on deployment'
                };
            }

            await disableAndDeleteDistribution(state.deployment.cloudfrontDistributionId);

            state.deleted.cloudfront = true;

            return {
                distributionId: state.deployment.cloudfrontDistributionId,
                deleted: true
            };
        });

        if (!result.ok) {
            await persistFailureState(state, 'CLOUDFRONT_DELETE', result.failure);
            return result.failure;
        }
    }

    // 5. S3_POLICY_DELETE
    {
        const result = await runStage(state, 'S3_POLICY_DELETE', async () => {
            if (!state.deployment?.bucketName) {
                throw new Error('bucketName missing before S3 policy delete');
            }

            await removeCloudFrontReadAccess({
                bucketName: state.deployment.bucketName
            });

            state.deleted.s3Policy = true;

            return {
                bucketName: state.deployment.bucketName,
                policyRemoved: true
            };
        });

        if (!result.ok) {
            await persistFailureState(state, 'S3_POLICY_DELETE', result.failure);
            return result.failure;
        }
    }

    // 6. S3_BUCKET_DELETE
    {
        const result = await runStage(state, 'S3_BUCKET_DELETE', async () => {
            if (!state.deployment?.bucketName) {
                throw new Error('bucketName missing before S3 bucket delete');
            }

            await emptyAndDeleteBucket({
                bucketName: state.deployment.bucketName
            });

            state.deleted.s3Bucket = true;

            return {
                bucketName: state.deployment.bucketName,
                deleted: true
            };
        });

        if (!result.ok) {
            await persistFailureState(state, 'S3_BUCKET_DELETE', result.failure);
            return result.failure;
        }
    }

    // 7. ACM_DELETE
    {
        const result = await runStage(state, 'ACM_DELETE', async () => {
            if (!state.deployment?.certificateArn) {
                return {
                    skipped: true,
                    reason: 'No certificateArn on deployment'
                };
            }

            await deleteCertificateIfExists({
                certificateArn: state.deployment.certificateArn
            });

            state.deleted.acm = true;

            return {
                certificateArn: state.deployment.certificateArn,
                deleted: true
            };
        });

        if (!result.ok) {
            await persistFailureState(state, 'ACM_DELETE', result.failure);
            return result.failure;
        }
    }

    // 8. DYNAMODB
    {
        const result = await runStage(state, 'DYNAMODB', async () => {
            if (!state.deployment) {
                throw new Error('deployment missing before persistence');
            }

            const timestamp = nowIso();

            await putDeployment({
                ...state.deployment,
                id: state.deployment.id,
                customerId: state.deployment.customerId,
                status: 'DELETED',
                currentStage: 'DYNAMODB',
                updatedAt: timestamp,
                deletedAt: timestamp,
                lastError: undefined,
                lastErrorDetails: undefined,
                deletionEvents: [
                    ...((Array.isArray(state.deployment.deletionEvents)
                        ? state.deployment.deletionEvents
                        : []) as unknown[]),
                    {
                        type: 'DELETE_EVERYTHING_COMPLETED',
                        deleted: state.deleted,
                        at: timestamp
                    }
                ]
            });

            await putJob({
                id: state.jobId,
                customerId: state.customerId,
                deploymentId: state.deploymentId,
                jobType: 'DELETE_EVERYTHING',
                status: 'SUCCEEDED',
                payload: {
                    deleted: state.deleted
                },
                stages: state.stages,
                createdAt: timestamp,
                updatedAt: timestamp
            });

            return {
                deploymentId: state.deploymentId,
                jobId: state.jobId,
                deleted: state.deleted
            };
        });

        if (!result.ok) {
            await persistFailureState(state, 'DYNAMODB', result.failure);
            return result.failure;
        }
    }

    // 9. SQS
    {
        const result = await runStage(state, 'SQS', async () => {
            await queueJob({
                jobId: state.jobId,
                deploymentId: state.deploymentId,
                customerId: state.customerId,
                type: 'DELETE_EVERYTHING'
            });

            return {
                queued: true,
                jobId: state.jobId
            };
        });

        if (!result.ok) {
            await persistFailureState(state, 'SQS', result.failure);
            return result.failure;
        }
    }

    return {
        success: true,
        deploymentId: state.deploymentId,
        jobId: state.jobId,
        customerId: state.customerId,
        deleted: state.deleted,
        stages: state.stages
    };
}