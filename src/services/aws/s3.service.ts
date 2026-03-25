import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketVersioningCommand,
  PutPublicAccessBlockCommand,
  PutBucketTaggingCommand,
  PutBucketOwnershipControlsCommand,
  BucketLocationConstraint
} from '@aws-sdk/client-s3';
import { env } from '../../config/env';

const s3 = new S3Client({ region: env.awsRegion });

export async function createCustomerBucket(bucketName: string) {
  const exists = await bucketExists(bucketName);

  if (!exists) {
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
    } catch (err: any) {
      const code = err?.name || err?.Code;

      if (code !== 'BucketAlreadyOwnedByYou' && code !== 'BucketAlreadyExists') {
        throw err;
      }

      console.log(`[S3] Bucket already existed during create: ${bucketName}`);
    }
  } else {
    console.log(`[S3] Bucket already exists: ${bucketName}`);
  }

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

  await s3.send(
    new PutBucketVersioningCommand({
      Bucket: bucketName,
      VersioningConfiguration: {
        Status: 'Enabled'
      }
    })
  );

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

  await s3.send(
    new PutBucketTaggingCommand({
      Bucket: bucketName,
      Tagging: {
        TagSet: [
          { Key: 'managed-by', Value: 'vedantix' },
          { Key: 'type', Value: 'customer-site' }
        ]
      }
    })
  );

  return {
    bucketName,
    region: env.awsRegion
  };
}

async function bucketExists(bucketName: string): Promise<boolean> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucketName }));
    return true;
  } catch (err: any) {
    const code = err?.name || err?.Code;
    const status = err?.$metadata?.httpStatusCode;

    if (
      status === 404 ||
      code === 'NotFound' ||
      code === 'NoSuchBucket'
    ) {
      return false;
    }

    if (code === 'Forbidden' || status === 403) {
      console.warn(`[S3] HeadBucket returned 403 for ${bucketName}, assuming it exists`);
      return true;
    }

    throw err;
  }
}