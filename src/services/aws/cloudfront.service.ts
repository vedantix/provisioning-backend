import {
  CloudFrontClient,
  CreateDistributionCommand
} from '@aws-sdk/client-cloudfront';
import { env } from '../../config/env';

const cloudfront = new CloudFrontClient({ region: env.awsAcmRegion });

export async function createDistribution(params: {
  bucketRegionalDomainName: string;
  domainNames: string[];
  certificateArn: string;
}) {
  if (!params.domainNames.length) {
    throw new Error('At least one domain name is required for CloudFront distribution');
  }

  const primaryDomain = params.domainNames[0];

  const result = await cloudfront.send(
    new CreateDistributionCommand({
      DistributionConfig: {
        CallerReference: `${Date.now()}-${primaryDomain}`,
        Comment: `Vedantix distribution for ${primaryDomain}`,
        Enabled: true,
        DefaultRootObject: 'index.html',
        Aliases: {
          Quantity: params.domainNames.length,
          Items: params.domainNames
        },
        Origins: {
          Quantity: 1,
          Items: [
            {
              Id: 'site-origin',
              DomainName: params.bucketRegionalDomainName,
              S3OriginConfig: {
                OriginAccessIdentity: ''
              }
            }
          ]
        },
        DefaultCacheBehavior: {
          TargetOriginId: 'site-origin',
          ViewerProtocolPolicy: 'redirect-to-https',
          Compress: true,
          AllowedMethods: {
            Quantity: 2,
            Items: ['GET', 'HEAD'],
            CachedMethods: {
              Quantity: 2,
              Items: ['GET', 'HEAD']
            }
          },
          ForwardedValues: {
            QueryString: false,
            Cookies: {
              Forward: 'none'
            }
          },
          MinTTL: 0
        },
        ViewerCertificate: {
          ACMCertificateArn: params.certificateArn,
          SSLSupportMethod: 'sni-only',
          MinimumProtocolVersion: 'TLSv1.2_2021'
        }
      }
    })
  );

  if (!result.Distribution?.Id || !result.Distribution?.DomainName) {
    throw new Error(`Failed to create CloudFront distribution for ${primaryDomain}`);
  }

  return {
    distributionId: result.Distribution.Id,
    domainName: result.Distribution.DomainName
  };
}