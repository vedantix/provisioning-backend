import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketVersioningCommand,
  PutPublicAccessBlockCommand,
  PutBucketTaggingCommand,
  PutBucketOwnershipControlsCommand,
  PutBucketPolicyCommand,
  DeleteBucketPolicyCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  ListObjectVersionsCommand,
  ListObjectsV2Command,
  GetBucketLocationCommand,
  BucketLocationConstraint
} from '@aws-sdk/client-s3';
import { env } from '../../config/env';

const s3 = new S3Client({ region: env.awsRegion });

type CreateCustomerBucketOptions = {
  tags?: Record<string, string>;
};

type EnsureCloudFrontReadAccessParams = {
  bucketName: string;
  distributionArn: string;
};

type RemoveCloudFrontReadAccessParams = {
  bucketName: string;
};

type CustomerBucketResult = {
  bucketName: string;
  region: string;
  existed: boolean;
  bucketRegionalDomainName: string;
};

function bucketRegionalDomainName(bucketName: string): string {
  return env.awsRegion === 'us-east-1'
    ? `${bucketName}.s3.amazonaws.com`
    : `${bucketName}.s3.${env.awsRegion}.amazonaws.com`;
}

function toTagSet(tags?: Record<string, string>) {
  const baseTags: Record<string, string> = {
    'managed-by': 'vedantix',
    'type': 'customer-site'
  };

  const merged = {
    ...baseTags,
    ...(tags ?? {})
  };

  return Object.entries(merged).map(([Key, Value]) => ({ Key, Value }));
}

function buildCloudFrontReadPolicy(bucketName: string, distributionArn: string): string {
  return JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      {
        Sid: 'AllowCloudFrontServicePrincipalReadOnly',
        Effect: 'Allow',
        Principal: {
          Service: 'cloudfront.amazonaws.com'
        },
        Action: 's3:GetObject',
        Resource: `arn:aws:s3:::${bucketName}/*`,
        Condition: {
          StringEquals: {
            'AWS:SourceArn': distributionArn
          }
        }
      }
    ]
  });
}

function isAwsError(error: unknown): error is {
  name?: string;
  Code?: string;
  message?: string;
  $metadata?: { httpStatusCode?: number };
} {
  return typeof error === 'object' && error !== null;
}

function getAwsErrorCode(error: unknown): string | undefined {
  if (!isAwsError(error)) {
    return undefined;
  }

  return error.name ?? error.Code;
}

function getAwsStatusCode(error: unknown): number | undefined {
  if (!isAwsError(error)) {
    return undefined;
  }

  return error.$metadata?.httpStatusCode;
}

async function bucketExists(bucketName: string): Promise<boolean> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucketName }));
    return true;
  } catch (error) {
    const code = getAwsErrorCode(error);
    const status = getAwsStatusCode(error);

    if (status === 404 || code === 'NotFound' || code === 'NoSuchBucket') {
      return false;
    }

    // HeadBucket 403 is ambiguous in AWS:
    // it can mean "exists but no access" or other permission-related outcomes.
    // For this backend we only manage buckets in our own account, so surface it.
    if (status === 403 || code === 'Forbidden' || code === 'AccessDenied') {
      throw new Error(
        `HeadBucket returned 403/AccessDenied for "${bucketName}". Refusing to assume existence.`
      );
    }

    throw error;
  }
}

async function ensureBucketCreated(bucketName: string): Promise<{ existed: boolean }> {
  const exists = await bucketExists(bucketName);

  if (exists) {
    console.log(`[S3] Bucket already exists: ${bucketName}`);
    return { existed: true };
  }

  console.log(`[S3] Creating bucket: ${bucketName}`);

  try {
    await s3.send(
      new CreateBucketCommand({
        Bucket: bucketName,
        ...(env.awsRegion !== 'us-east-1' && {
          CreateBucketConfiguration: {
            LocationConstraint: env.awsRegion as BucketLocationConstraint
          }
        })
      })
    );

    return { existed: false };
  } catch (error) {
    const code = getAwsErrorCode(error);

    if (code === 'BucketAlreadyOwnedByYou') {
      console.log(`[S3] Bucket already owned by this account during create: ${bucketName}`);
      return { existed: true };
    }

    if (code === 'BucketAlreadyExists') {
      throw new Error(
        `Bucket name "${bucketName}" already exists globally and is not safe to use.`
      );
    }

    throw error;
  }
}

async function ensureOwnershipControls(bucketName: string): Promise<void> {
  await s3.send(
    new PutBucketOwnershipControlsCommand({
      Bucket: bucketName,
      OwnershipControls: {
        Rules: [
          {
            ObjectOwnership: 'BucketOwnerEnforced'
          }
        ]
      }
    })
  );
}

async function ensureVersioning(bucketName: string): Promise<void> {
  await s3.send(
    new PutBucketVersioningCommand({
      Bucket: bucketName,
      VersioningConfiguration: {
        Status: 'Enabled'
      }
    })
  );
}

async function ensurePublicAccessBlock(bucketName: string): Promise<void> {
  await s3.send(
    new PutPublicAccessBlockCommand({
      Bucket: bucketName,
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        IgnorePublicAcls: true,
        BlockPublicPolicy: true,
        RestrictPublicBuckets: true
      }
    })
  );
}

async function ensureTagging(
  bucketName: string,
  tags?: Record<string, string>
): Promise<void> {
  await s3.send(
    new PutBucketTaggingCommand({
      Bucket: bucketName,
      Tagging: {
        TagSet: toTagSet(tags)
      }
    })
  );
}

export async function createCustomerBucket(
  bucketName: string,
  options?: CreateCustomerBucketOptions
): Promise<CustomerBucketResult> {
  const { existed } = await ensureBucketCreated(bucketName);

  await ensureOwnershipControls(bucketName);
  await ensureVersioning(bucketName);
  await ensurePublicAccessBlock(bucketName);
  await ensureTagging(bucketName, options?.tags);

  return {
    bucketName,
    region: env.awsRegion,
    existed,
    bucketRegionalDomainName: bucketRegionalDomainName(bucketName)
  };
}

export async function ensureCloudFrontReadAccess(
  params: EnsureCloudFrontReadAccessParams
): Promise<{
  bucketName: string;
  distributionArn: string;
  policyApplied: true;
}> {
  const policy = buildCloudFrontReadPolicy(params.bucketName, params.distributionArn);

  await s3.send(
    new PutBucketPolicyCommand({
      Bucket: params.bucketName,
      Policy: policy
    })
  );

  return {
    bucketName: params.bucketName,
    distributionArn: params.distributionArn,
    policyApplied: true
  };
}

export async function removeCloudFrontReadAccess(
  params: RemoveCloudFrontReadAccessParams
): Promise<{
  bucketName: string;
  policyRemoved: true;
}> {
  try {
    await s3.send(
      new DeleteBucketPolicyCommand({
        Bucket: params.bucketName
      })
    );
  } catch (error) {
    const code = getAwsErrorCode(error);

    if (code !== 'NoSuchBucketPolicy') {
      throw error;
    }
  }

  return {
    bucketName: params.bucketName,
    policyRemoved: true
  };
}

export async function getBucketRegion(bucketName: string): Promise<string> {
  const result = await s3.send(
    new GetBucketLocationCommand({
      Bucket: bucketName
    })
  );

  // AWS returns null/undefined or empty for us-east-1 in some contexts.
  const location = result.LocationConstraint;

  if (!location) {
    return 'us-east-1';
  }

  return location;
}

export function buildBucketRegionalDomainName(bucketName: string): string {
  return bucketRegionalDomainName(bucketName);
}

type EmptyAndDeleteBucketParams = {
  bucketName: string;
};

async function deleteAllCurrentObjects(bucketName: string): Promise<void> {
  let continuationToken: string | undefined;

  do {
    const result = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucketName,
        ContinuationToken: continuationToken
      })
    );

    const objects = result.Contents ?? [];

    for (const object of objects) {
      if (!object.Key) {
        continue;
      }

      await s3.send(
        new DeleteObjectCommand({
          Bucket: bucketName,
          Key: object.Key
        })
      );
    }

    continuationToken = result.NextContinuationToken;
  } while (continuationToken);
}

async function deleteAllObjectVersions(bucketName: string): Promise<void> {
  let keyMarker: string | undefined;
  let versionIdMarker: string | undefined;

  do {
    const result = await s3.send(
      new ListObjectVersionsCommand({
        Bucket: bucketName,
        KeyMarker: keyMarker,
        VersionIdMarker: versionIdMarker
      })
    );

    const versions = result.Versions ?? [];
    const deleteMarkers = result.DeleteMarkers ?? [];

    for (const version of versions) {
      if (!version.Key || !version.VersionId) {
        continue;
      }

      await s3.send(
        new DeleteObjectCommand({
          Bucket: bucketName,
          Key: version.Key,
          VersionId: version.VersionId
        })
      );
    }

    for (const marker of deleteMarkers) {
      if (!marker.Key || !marker.VersionId) {
        continue;
      }

      await s3.send(
        new DeleteObjectCommand({
          Bucket: bucketName,
          Key: marker.Key,
          VersionId: marker.VersionId
        })
      );
    }

    keyMarker = result.NextKeyMarker;
    versionIdMarker = result.NextVersionIdMarker;
  } while (keyMarker);
}

export async function emptyAndDeleteBucket(
  params: EmptyAndDeleteBucketParams
): Promise<{
  bucketName: string;
  deleted: true;
}> {
  await deleteAllObjectVersions(params.bucketName);
  await deleteAllCurrentObjects(params.bucketName);

  await s3.send(
    new DeleteBucketCommand({
      Bucket: params.bucketName
    })
  );

  return {
    bucketName: params.bucketName,
    deleted: true
  };
}