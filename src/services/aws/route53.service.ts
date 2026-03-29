import {
  Route53Client,
  ChangeResourceRecordSetsCommand,
  ListHostedZonesByNameCommand,
  ListResourceRecordSetsCommand,
  ResourceRecordSet,
  RRType
} from '@aws-sdk/client-route-53';
import { env } from '../../config/env';

const route53 = new Route53Client({ region: env.awsRegion });

const CLOUDFRONT_HOSTED_ZONE_ID = 'Z2FDTNDATAQYW2';

type DnsValidationRecord = {
  name: string;
  type: string;
  value: string;
};

type AliasRecordType = 'A' | 'AAAA';

function normalizeDnsName(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, '');
}

function ensureTrailingDot(value: string): string {
  return value.endsWith('.') ? value : `${value}.`;
}

function toRoute53RecordName(value: string): string {
  return ensureTrailingDot(normalizeDnsName(value));
}

function toAliasRecordTypes(): AliasRecordType[] {
  return ['A', 'AAAA'];
}

function buildCandidateZoneNames(domain: string): string[] {
  const normalized = normalizeDnsName(domain);
  const labels = normalized.split('.');
  const candidates: string[] = [];

  for (let i = 0; i < labels.length - 1; i += 1) {
    candidates.push(labels.slice(i).join('.'));
  }

  return candidates;
}

async function listAllHostedZones(): Promise<Array<{ id: string; name: string }>> {
  const zones: Array<{ id: string; name: string }> = [];
  let dnsName: string | undefined;
  let hostedZoneId: string | undefined;

  do {
    const result = await route53.send(
      new ListHostedZonesByNameCommand({
        DNSName: dnsName,
        HostedZoneId: hostedZoneId
      })
    );

    for (const zone of result.HostedZones ?? []) {
      if (!zone.Id || !zone.Name) {
        continue;
      }

      zones.push({
        id: zone.Id.replace('/hostedzone/', ''),
        name: normalizeDnsName(zone.Name)
      });
    }

    dnsName = result.NextDNSName;
    hostedZoneId = result.NextHostedZoneId?.replace('/hostedzone/', '');
  } while (dnsName);

  return zones;
}

async function findBestHostedZoneId(domain: string): Promise<string | null> {
  const normalizedDomain = normalizeDnsName(domain);
  const candidates = buildCandidateZoneNames(normalizedDomain);
  const hostedZones = await listAllHostedZones();

  for (const candidate of candidates) {
    const zone = hostedZones.find((z) => z.name === candidate);

    if (zone) {
      return zone.id;
    }
  }

  return null;
}

async function upsertRecord(params: {
  hostedZoneId: string;
  record: ResourceRecordSet;
}): Promise<void> {
  await route53.send(
    new ChangeResourceRecordSetsCommand({
      HostedZoneId: params.hostedZoneId,
      ChangeBatch: {
        Changes: [
          {
            Action: 'UPSERT',
            ResourceRecordSet: params.record
          }
        ]
      }
    })
  );
}

async function deleteRecord(params: {
  hostedZoneId: string;
  record: ResourceRecordSet;
}): Promise<void> {
  await route53.send(
    new ChangeResourceRecordSetsCommand({
      HostedZoneId: params.hostedZoneId,
      ChangeBatch: {
        Changes: [
          {
            Action: 'DELETE',
            ResourceRecordSet: params.record
          }
        ]
      }
    })
  );
}

async function findExactRecord(
  hostedZoneId: string,
  name: string,
  type: RRType
): Promise<ResourceRecordSet | null> {
  const normalizedName = normalizeDnsName(name);

  const result = await route53.send(
    new ListResourceRecordSetsCommand({
      HostedZoneId: hostedZoneId,
      StartRecordName: normalizedName,
      StartRecordType: type,
      MaxItems: 10
    })
  );

  const record =
    result.ResourceRecordSets?.find(
      (item) =>
        normalizeDnsName(item.Name ?? '') === normalizedName &&
        item.Type === type
    ) ?? null;

  return record;
}

function buildDnsValidationResourceRecordSet(record: DnsValidationRecord): ResourceRecordSet {
  const normalizedType = record.type.toUpperCase();

  if (normalizedType !== 'CNAME') {
    throw new Error(
      `Unsupported DNS validation record type "${record.type}". Expected CNAME.`
    );
  }

  return {
    Name: toRoute53RecordName(record.name),
    Type: 'CNAME',
    TTL: 300,
    ResourceRecords: [
      {
        Value: ensureTrailingDot(record.value)
      }
    ]
  };
}

function buildCloudFrontAliasRecord(params: {
  domain: string;
  cloudFrontDomainName: string;
  type: AliasRecordType;
}): ResourceRecordSet {
  return {
    Name: toRoute53RecordName(params.domain),
    Type: params.type,
    AliasTarget: {
      DNSName: ensureTrailingDot(normalizeDnsName(params.cloudFrontDomainName)),
      HostedZoneId: CLOUDFRONT_HOSTED_ZONE_ID,
      EvaluateTargetHealth: false
    }
  };
}

export async function upsertDnsValidationRecord(
  name: string,
  type: string,
  value: string
): Promise<{
  name: string;
  type: string;
  hostedZoneId: string;
  upserted: true;
}> {
  const normalizedName = normalizeDnsName(name);
  const normalizedType = type.toUpperCase();
  const hostedZoneId = await findBestHostedZoneId(normalizedName);

  if (!hostedZoneId) {
    throw new Error(`Hosted zone not found for DNS validation record ${normalizedName}`);
  }

  const record = buildDnsValidationResourceRecordSet({
    name,
    type,
    value
  });

  await upsertRecord({
    hostedZoneId,
    record
  });

  console.log(
    `[ROUTE53] Upserted DNS validation record ${normalizedType} ${normalizedName} in hosted zone ${hostedZoneId}`
  );

  return {
    name: normalizedName,
    type: normalizedType,
    hostedZoneId,
    upserted: true
  };
}

export async function upsertCloudFrontAliasRecords(
  domains: string[],
  cloudFrontDomainName: string
): Promise<{
  cloudFrontDomainName: string;
  upsertedDomains: string[];
}> {
  const normalizedDomains = [...new Set(domains.map(normalizeDnsName))];

  for (const domain of normalizedDomains) {
    const hostedZoneId = await findBestHostedZoneId(domain);

    if (!hostedZoneId) {
      throw new Error(`Hosted zone not found for alias domain ${domain}`);
    }

    for (const type of toAliasRecordTypes()) {
      const record = buildCloudFrontAliasRecord({
        domain,
        cloudFrontDomainName,
        type
      });

      await upsertRecord({
        hostedZoneId,
        record
      });

      console.log(
        `[ROUTE53] Upserted ${type} CloudFront alias for ${domain} in hosted zone ${hostedZoneId}`
      );
    }
  }

  return {
    cloudFrontDomainName: normalizeDnsName(cloudFrontDomainName),
    upsertedDomains: normalizedDomains
  };
}

async function removeSingleDnsRecordIfExists(params: {
  hostedZoneId: string;
  name: string;
  type: RRType;
}): Promise<boolean> {
  const record = await findExactRecord(
    params.hostedZoneId,
    params.name,
    params.type
  );

  if (!record) {
    return false;
  }

  await deleteRecord({
    hostedZoneId: params.hostedZoneId,
    record
  });

  return true;
}

async function removeSingleAliasRecord(domain: string): Promise<{
  domain: string;
  removedTypes: string[];
  hostedZoneId: string;
}> {
  const normalizedDomain = normalizeDnsName(domain);
  const hostedZoneId = await findBestHostedZoneId(normalizedDomain);

  if (!hostedZoneId) {
    throw new Error(`Hosted zone not found for domain ${normalizedDomain}`);
  }

  const removedTypes: string[] = [];

  for (const type of toAliasRecordTypes()) {
    const removed = await removeSingleDnsRecordIfExists({
      hostedZoneId,
      name: normalizedDomain,
      type
    });

    if (removed) {
      removedTypes.push(type);
      console.log(
        `[ROUTE53] Deleted ${type} alias record for ${normalizedDomain} in hosted zone ${hostedZoneId}`
      );
    }
  }

  if (!removedTypes.length) {
    console.warn(`[ROUTE53] No alias records found for ${normalizedDomain}, skipping delete`);
  }

  return {
    domain: normalizedDomain,
    removedTypes,
    hostedZoneId
  };
}

export async function removeCloudFrontAliasRecords(domains: string[]) {
  const normalizedDomains = [...new Set(domains.map(normalizeDnsName))];
  const removed: Array<{
    domain: string;
    removedTypes: string[];
    hostedZoneId: string;
  }> = [];

  for (const domain of normalizedDomains) {
    try {
      const result = await removeSingleAliasRecord(domain);
      removed.push(result);
    } catch (error) {
      console.warn(`[ROUTE53] Failed to remove alias record for ${domain}`, error);
      throw error;
    }
  }

  return {
    removedDomains: normalizedDomains,
    removed
  };
}