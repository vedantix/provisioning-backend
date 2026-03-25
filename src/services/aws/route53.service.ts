import {
  ChangeResourceRecordSetsCommand,
  Route53Client,
  RRType
} from '@aws-sdk/client-route-53';
import { env } from '../../config/env';

const route53 = new Route53Client({ region: env.awsRegion });

const CLOUDFRONT_HOSTED_ZONE_ID = 'Z2FDTNDATAQYW2';

export async function upsertDnsValidationRecord(
  name: string,
  type: RRType,
  value: string
) {
  if (!name || !type || !value) {
    throw new Error('Missing required DNS validation record fields');
  }

  await route53.send(
    new ChangeResourceRecordSetsCommand({
      HostedZoneId: env.route53HostedZoneId,
      ChangeBatch: {
        Changes: [
          {
            Action: 'UPSERT',
            ResourceRecordSet: {
              Name: name,
              Type: type,
              TTL: 300,
              ResourceRecords: [{ Value: value }]
            }
          }
        ]
      }
    })
  );
}

export async function upsertCloudFrontAliasRecord(
  domainName: string,
  cloudFrontDomainName: string
) {
  if (!domainName || !cloudFrontDomainName) {
    throw new Error('Missing required CloudFront alias record fields');
  }

  await route53.send(
    new ChangeResourceRecordSetsCommand({
      HostedZoneId: env.route53HostedZoneId,
      ChangeBatch: {
        Changes: [
          {
            Action: 'UPSERT',
            ResourceRecordSet: {
              Name: domainName,
              Type: 'A',
              AliasTarget: {
                DNSName: cloudFrontDomainName,
                HostedZoneId: CLOUDFRONT_HOSTED_ZONE_ID,
                EvaluateTargetHealth: false
              }
            }
          }
        ]
      }
    })
  );
}

export async function upsertCloudFrontIpv6AliasRecord(
  domainName: string,
  cloudFrontDomainName: string
) {
  if (!domainName || !cloudFrontDomainName) {
    throw new Error('Missing required CloudFront IPv6 alias record fields');
  }

  await route53.send(
    new ChangeResourceRecordSetsCommand({
      HostedZoneId: env.route53HostedZoneId,
      ChangeBatch: {
        Changes: [
          {
            Action: 'UPSERT',
            ResourceRecordSet: {
              Name: domainName,
              Type: 'AAAA',
              AliasTarget: {
                DNSName: cloudFrontDomainName,
                HostedZoneId: CLOUDFRONT_HOSTED_ZONE_ID,
                EvaluateTargetHealth: false
              }
            }
          }
        ]
      }
    })
  );
}

export async function upsertCloudFrontAliasRecords(
  domainNames: string[],
  cloudFrontDomainName: string
) {
  for (const domainName of domainNames) {
    await upsertCloudFrontAliasRecord(domainName, cloudFrontDomainName);
    await upsertCloudFrontIpv6AliasRecord(domainName, cloudFrontDomainName);
  }
}