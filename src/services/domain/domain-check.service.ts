import dns from "node:dns/promises";
import axios from "axios";
import {
  CreateHostedZoneCommand,
  GetHostedZoneCommand,
  Route53Client,
  ListHostedZonesByNameCommand,
  ListResourceRecordSetsCommand,
  HostedZone,
  ResourceRecordSet,
} from "@aws-sdk/client-route-53";
import { parse } from "tldts";
import {
  registerDomainIfAvailable,
  type DomainRegistrationResult,
} from "./domain-registration.service";
import { env } from "../../config/env";

export type DomainCheckStatus =
  | "AVAILABLE"
  | "INVALID"
  | "HOSTED_ZONE_NOT_FOUND"
  | "DOMAIN_REGISTRATION_DISABLED"
  | "DOMAIN_REGISTRATION_PENDING"
  | "DOMAIN_REGISTRATION_FAILED"
  | "DELEGATION_PENDING"
  | "RECORD_CONFLICT"
  | "HTTP_ACTIVE";

export type DomainCheckResult = {
  domain: string;
  rootDomain: string;
  hostedZoneId?: string;
  hostedZoneName?: string;
  hostedZoneCreated?: boolean;
  expectedNameServers?: string[];
  actualNameServers?: string[];
  domainRegistration?: DomainRegistrationResult;
  status: DomainCheckStatus;
  canProceed: boolean;
  details: Record<string, unknown>;
};

const route53 = new Route53Client({
  region: process.env.AWS_REGION,
});

const CLOUDFRONT_HOSTED_ZONE_ID = "Z2FDTNDATAQYW2";

function normalizeDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/\.$/, "");
}

async function lookupSafe(
  domain: string,
  rrtype: "A" | "AAAA" | "CNAME"
): Promise<string[]> {
  try {
    const result = await dns.resolve(domain, rrtype);

    return Array.isArray(result)
      ? result.map((value) =>
          typeof value === "string" ? value : JSON.stringify(value)
        )
      : [];
  } catch {
    return [];
  }
}

async function checkHttp(url: string): Promise<{
  reachable: boolean;
  status?: number;
}> {
  try {
    const response = await axios.get(url, {
      timeout: 4000,
      maxRedirects: 3,
      validateStatus: () => true,
    });

    return {
      reachable: true,
      status: response.status,
    };
  } catch {
    return {
      reachable: false,
    };
  }
}

function isMatchingHostedZone(zone: HostedZone, wantedFqdn: string): boolean {
  if (!zone.Name) return false;

  return wantedFqdn === zone.Name || wantedFqdn.endsWith(zone.Name);
}

function normalizeNameServer(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

function normalizeRecordName(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

function toRoute53RecordName(value: string): string {
  const normalized = normalizeRecordName(value);
  return normalized.endsWith(".") ? normalized : `${normalized}.`;
}

function isCloudFrontAliasRecord(record?: ResourceRecordSet | null): boolean {
  const hostedZoneId = record?.AliasTarget?.HostedZoneId;
  const dnsName = normalizeRecordName(record?.AliasTarget?.DNSName ?? "");

  return (
    hostedZoneId === CLOUDFRONT_HOSTED_ZONE_ID &&
    dnsName.endsWith(".cloudfront.net")
  );
}

async function findExactHostedZoneRecord(
  hostedZoneId: string,
  name: string,
  type: "A" | "AAAA"
): Promise<ResourceRecordSet | null> {
  const normalizedName = normalizeRecordName(name);

  const result = await route53.send(
    new ListResourceRecordSetsCommand({
      HostedZoneId: hostedZoneId,
      StartRecordName: toRoute53RecordName(normalizedName),
      StartRecordType: type,
      MaxItems: 10,
    })
  );

  return (
    result.ResourceRecordSets?.find(
      (record) =>
        normalizeRecordName(record.Name ?? "") === normalizedName &&
        record.Type === type
    ) ?? null
  );
}

async function findManagedCloudFrontAliases(
  hostedZoneId: string,
  domains: string[]
): Promise<Array<{ domain: string; type: "A" | "AAAA"; dnsName: string }>> {
  const aliases: Array<{ domain: string; type: "A" | "AAAA"; dnsName: string }> = [];
  const normalizedDomains = [...new Set(domains.map(normalizeRecordName).filter(Boolean))];

  for (const domain of normalizedDomains) {
    for (const type of ["A", "AAAA"] as const) {
      const record = await findExactHostedZoneRecord(hostedZoneId, domain, type);

      if (!isCloudFrontAliasRecord(record)) {
        continue;
      }

      aliases.push({
        domain,
        type,
        dnsName: normalizeRecordName(record?.AliasTarget?.DNSName ?? ""),
      });
    }
  }

  return aliases;
}

function hasManagedAlias(
  aliases: Array<{ domain: string; type: "A" | "AAAA" }>,
  domain: string,
  type: "A" | "AAAA"
): boolean {
  const normalizedDomain = normalizeRecordName(domain);

  return aliases.some(
    (alias) => alias.domain === normalizedDomain && alias.type === type
  );
}

function hasRoute53Delegation(
  expectedNameServers: string[],
  actualNameServers: string[]
): boolean {
  const expected = expectedNameServers.map(normalizeNameServer).sort();
  const actual = new Set(actualNameServers.map(normalizeNameServer));

  return expected.length > 0 && expected.every((nameServer) => actual.has(nameServer));
}

async function resolveNameServersSafe(rootDomain: string): Promise<string[]> {
  try {
    return (await dns.resolveNs(rootDomain)).map(normalizeNameServer).sort();
  } catch {
    return [];
  }
}

async function findBestHostedZone(
  rootDomain: string,
  preferredNameServers: string[] = []
): Promise<{ id: string; name: string; nameServers: string[] } | null> {
  const response = await route53.send(
    new ListHostedZonesByNameCommand({
      DNSName: rootDomain,
      MaxItems: 20,
    })
  );

  const zones = response.HostedZones ?? [];
  const wantedFqdn = rootDomain.endsWith(".") ? rootDomain : `${rootDomain}.`;

  const matches = zones
    .filter((zone) => isMatchingHostedZone(zone, wantedFqdn))
    .sort((a, b) => (b.Name ?? "").length - (a.Name ?? "").length);

  if (matches.length === 0) {
    return null;
  }

  const hydratedMatches = (
    await Promise.all(
      matches.map(async (hostedZone) => {
        if (!hostedZone.Id || !hostedZone.Name) return null;

        const zone = await route53.send(
          new GetHostedZoneCommand({
            Id: hostedZone.Id,
          })
        );

        return {
          id: hostedZone.Id.replace("/hostedzone/", ""),
          name: hostedZone.Name,
          nameServers: (zone.DelegationSet?.NameServers ?? [])
            .map(normalizeNameServer)
            .sort(),
        };
      })
    )
  ).filter((zone): zone is { id: string; name: string; nameServers: string[] } =>
    Boolean(zone)
  );

  if (preferredNameServers.length > 0) {
    const delegatedMatch = hydratedMatches.find((hostedZone) =>
      hasRoute53Delegation(hostedZone.nameServers, preferredNameServers)
    );

    if (delegatedMatch) {
      return delegatedMatch;
    }
  }

  return hydratedMatches[0] ?? null;
}

async function createHostedZone(
  rootDomain: string
): Promise<{ id: string; name: string; nameServers: string[]; created: boolean }> {
  try {
    const result = await route53.send(
      new CreateHostedZoneCommand({
        Name: rootDomain,
        CallerReference: `vedantix-${rootDomain}-${Date.now()}`,
        HostedZoneConfig: {
          Comment: `Created by Vedantix provisioning for ${rootDomain}`,
        },
      })
    );

    if (!result.HostedZone?.Id || !result.HostedZone.Name) {
      throw new Error(`Route53 did not return a hosted zone for ${rootDomain}`);
    }

    return {
      id: result.HostedZone.Id.replace("/hostedzone/", ""),
      name: result.HostedZone.Name,
      nameServers: (result.DelegationSet?.NameServers ?? [])
        .map(normalizeNameServer)
        .sort(),
      created: true,
    };
  } catch (error) {
    const errorName =
      error instanceof Error && "name" in error ? error.name : "";

    if (errorName === "HostedZoneAlreadyExists") {
      const existing = await findBestHostedZone(rootDomain);
      if (existing) {
        return {
          ...existing,
          created: false,
        };
      }
    }

    throw error;
  }
}

async function ensureHostedZone(
  rootDomain: string
): Promise<{ id: string; name: string; nameServers: string[]; created: boolean }> {
  const existing = await findBestHostedZone(rootDomain);
  if (existing) {
    return {
      ...existing,
      created: false,
    };
  }

  return createHostedZone(rootDomain);
}

async function waitForHostedZoneAfterRegistration(
  rootDomain: string
): Promise<{ id: string; name: string; nameServers: string[] } | null> {
  const deadline = Date.now() + 30_000;

  while (Date.now() <= deadline) {
    const hostedZone = await findBestHostedZone(rootDomain);
    if (hostedZone) {
      return hostedZone;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 3_000);
    });
  }

  return null;
}

async function waitForRoute53Delegation(
  rootDomain: string,
  expectedNameServers: string[]
): Promise<string[]> {
  const timeoutMs = Math.max(0, env.domainRegistrationWaitSeconds) * 1000;
  const deadline = Date.now() + timeoutMs;
  let actualNameServers: string[] = [];

  while (Date.now() <= deadline) {
    actualNameServers = await resolveNameServersSafe(rootDomain);

    if (hasRoute53Delegation(expectedNameServers, actualNameServers)) {
      return actualNameServers;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 15_000);
    });
  }

  return actualNameServers;
}

export async function checkDomainAvailability(
  input: string
): Promise<DomainCheckResult> {
  const domain = normalizeDomain(input);
  const parsed = parse(domain);

  if (!parsed.isIcann || !parsed.domain) {
    return {
      domain,
      rootDomain: "",
      status: "INVALID",
      canProceed: false,
      details: {
        reason: "Domain is not a valid ICANN domain",
      },
    };
  }

  const rootDomain = parsed.domain;
  let hostedZone = await findBestHostedZone(rootDomain);
  let hostedZoneCreated = false;
  let domainRegistration: DomainRegistrationResult | undefined;

  if (!hostedZone) {
    domainRegistration = await registerDomainIfAvailable(rootDomain);

    if (domainRegistration.availability === "AVAILABLE") {
      if (!domainRegistration.enabled) {
        return {
          domain,
          rootDomain,
          domainRegistration,
          status: "DOMAIN_REGISTRATION_DISABLED",
          canProceed: false,
          details: {
            reason: `${rootDomain} is available for registration, but DOMAIN_REGISTRATION_ENABLED is false`,
            domainRegistration,
          },
        };
      }

      if (
        !domainRegistration.submitted ||
        domainRegistration.operationStatus === "FAILED" ||
        domainRegistration.operationStatus === "ERROR"
      ) {
        return {
          domain,
          rootDomain,
          domainRegistration,
          status: "DOMAIN_REGISTRATION_FAILED",
          canProceed: false,
          details: {
            reason:
              domainRegistration.errorMessage ||
              domainRegistration.operationMessage ||
              `Domain registration failed for ${rootDomain}`,
            domainRegistration,
          },
        };
      }

      if (domainRegistration.operationStatus !== "SUCCESSFUL") {
        return {
          domain,
          rootDomain,
          domainRegistration,
          status: "DOMAIN_REGISTRATION_PENDING",
          canProceed: false,
          details: {
            reason:
              domainRegistration.operationMessage ||
              `Domain registration is still in progress for ${rootDomain}`,
            domainRegistration,
          },
        };
      }

      hostedZone = await waitForHostedZoneAfterRegistration(rootDomain);
      hostedZoneCreated = true;

      if (!hostedZone) {
        return {
          domain,
          rootDomain,
          domainRegistration,
          status: "DOMAIN_REGISTRATION_PENDING",
          canProceed: false,
          details: {
            reason: `Domain registration succeeded for ${rootDomain}, but the Route53 hosted zone is not visible yet`,
            domainRegistration,
          },
        };
      }
    } else if (domainRegistration.submitted) {
      if (
        domainRegistration.operationStatus === "FAILED" ||
        domainRegistration.operationStatus === "ERROR"
      ) {
        return {
          domain,
          rootDomain,
          domainRegistration,
          status: "DOMAIN_REGISTRATION_FAILED",
          canProceed: false,
          details: {
            reason:
              domainRegistration.errorMessage ||
              domainRegistration.operationMessage ||
              `Domain registration failed for ${rootDomain}`,
            domainRegistration,
          },
        };
      }

      if (domainRegistration.operationStatus !== "SUCCESSFUL") {
        return {
          domain,
          rootDomain,
          domainRegistration,
          status: "DOMAIN_REGISTRATION_PENDING",
          canProceed: false,
          details: {
            reason:
              domainRegistration.operationMessage ||
              `Domain registration is still in progress for ${rootDomain}`,
            domainRegistration,
          },
        };
      }

      hostedZone = await waitForHostedZoneAfterRegistration(rootDomain);
      hostedZoneCreated = true;

      if (!hostedZone) {
        return {
          domain,
          rootDomain,
          domainRegistration,
          status: "DOMAIN_REGISTRATION_PENDING",
          canProceed: false,
          details: {
            reason: `Domain registration succeeded for ${rootDomain}, but the Route53 hosted zone is not visible yet`,
            domainRegistration,
          },
        };
      }
    } else {
      const ensuredHostedZone = await ensureHostedZone(rootDomain);
      hostedZone = ensuredHostedZone;
      hostedZoneCreated = ensuredHostedZone.created;
    }
  }

  if (!hostedZone) {
    return {
      domain,
      rootDomain,
      domainRegistration,
      status: "HOSTED_ZONE_NOT_FOUND",
      canProceed: false,
      details: {
        reason: `No Route53 hosted zone found for ${rootDomain}`,
        domainRegistration,
      },
    };
  }

  let actualNameServers = await resolveNameServersSafe(rootDomain);
  let delegated = hasRoute53Delegation(
    hostedZone.nameServers,
    actualNameServers
  );

  if (
    !delegated &&
    domainRegistration?.submitted &&
    domainRegistration.operationStatus === "SUCCESSFUL"
  ) {
    actualNameServers = await waitForRoute53Delegation(
      rootDomain,
      hostedZone.nameServers
    );
    delegated = hasRoute53Delegation(hostedZone.nameServers, actualNameServers);
  }

  if (!delegated && actualNameServers.length > 0) {
    const delegatedHostedZone = await findBestHostedZone(
      rootDomain,
      actualNameServers
    );

    if (
      delegatedHostedZone &&
      delegatedHostedZone.id !== hostedZone.id &&
      hasRoute53Delegation(delegatedHostedZone.nameServers, actualNameServers)
    ) {
      hostedZone = delegatedHostedZone;
      delegated = true;
    }
  }

  if (!delegated && !domainRegistration) {
    domainRegistration = await registerDomainIfAvailable(rootDomain);

    if (domainRegistration.availability === "AVAILABLE") {
      if (!domainRegistration.enabled) {
        return {
          domain,
          rootDomain,
          hostedZoneId: hostedZone.id,
          hostedZoneName: hostedZone.name,
          hostedZoneCreated,
          expectedNameServers: hostedZone.nameServers,
          actualNameServers,
          domainRegistration,
          status: "DOMAIN_REGISTRATION_DISABLED",
          canProceed: false,
          details: {
            reason: `${rootDomain} is available for registration, but DOMAIN_REGISTRATION_ENABLED is false`,
            domainRegistration,
          },
        };
      }

      if (
        !domainRegistration.submitted ||
        domainRegistration.operationStatus === "FAILED" ||
        domainRegistration.operationStatus === "ERROR"
      ) {
        return {
          domain,
          rootDomain,
          hostedZoneId: hostedZone.id,
          hostedZoneName: hostedZone.name,
          hostedZoneCreated,
          expectedNameServers: hostedZone.nameServers,
          actualNameServers,
          domainRegistration,
          status: "DOMAIN_REGISTRATION_FAILED",
          canProceed: false,
          details: {
            reason:
              domainRegistration.errorMessage ||
              domainRegistration.operationMessage ||
              `Domain registration failed for ${rootDomain}`,
            domainRegistration,
          },
        };
      }

      if (domainRegistration.operationStatus !== "SUCCESSFUL") {
        return {
          domain,
          rootDomain,
          hostedZoneId: hostedZone.id,
          hostedZoneName: hostedZone.name,
          hostedZoneCreated,
          expectedNameServers: hostedZone.nameServers,
          actualNameServers,
          domainRegistration,
          status: "DOMAIN_REGISTRATION_PENDING",
          canProceed: false,
          details: {
            reason:
              domainRegistration.operationMessage ||
              `Domain registration is still in progress for ${rootDomain}`,
            domainRegistration,
          },
        };
      }

      actualNameServers = await resolveNameServersSafe(rootDomain);

      const registeredHostedZone =
        (await findBestHostedZone(rootDomain, actualNameServers)) ||
        (await waitForHostedZoneAfterRegistration(rootDomain)) ||
        hostedZone;

      hostedZone = registeredHostedZone;
      hostedZoneCreated = true;
      delegated = hasRoute53Delegation(hostedZone.nameServers, actualNameServers);
    } else if (domainRegistration.submitted) {
      if (
        domainRegistration.operationStatus === "FAILED" ||
        domainRegistration.operationStatus === "ERROR"
      ) {
        return {
          domain,
          rootDomain,
          hostedZoneId: hostedZone.id,
          hostedZoneName: hostedZone.name,
          hostedZoneCreated,
          expectedNameServers: hostedZone.nameServers,
          actualNameServers,
          domainRegistration,
          status: "DOMAIN_REGISTRATION_FAILED",
          canProceed: false,
          details: {
            reason:
              domainRegistration.errorMessage ||
              domainRegistration.operationMessage ||
              `Domain registration failed for ${rootDomain}`,
            domainRegistration,
          },
        };
      }

      if (domainRegistration.operationStatus !== "SUCCESSFUL") {
        return {
          domain,
          rootDomain,
          hostedZoneId: hostedZone.id,
          hostedZoneName: hostedZone.name,
          hostedZoneCreated,
          expectedNameServers: hostedZone.nameServers,
          actualNameServers,
          domainRegistration,
          status: "DOMAIN_REGISTRATION_PENDING",
          canProceed: false,
          details: {
            reason:
              domainRegistration.operationMessage ||
              `Domain registration is still in progress for ${rootDomain}`,
            domainRegistration,
          },
        };
      }

      actualNameServers = await waitForRoute53Delegation(
        rootDomain,
        hostedZone.nameServers
      );
      delegated = hasRoute53Delegation(hostedZone.nameServers, actualNameServers);
    }
  }

  if (!delegated) {
    return {
      domain,
      rootDomain,
      hostedZoneId: hostedZone.id,
      hostedZoneName: hostedZone.name,
      hostedZoneCreated,
      expectedNameServers: hostedZone.nameServers,
      actualNameServers,
      domainRegistration,
      status: "DELEGATION_PENDING",
      canProceed: false,
      details: {
        reason: hostedZoneCreated
          ? `Route53 hosted zone created for ${rootDomain}, but the domain is not delegated to Route53 yet`
          : `Route53 hosted zone exists for ${rootDomain}, but the domain is not delegated to Route53 yet`,
        expectedNameServers: hostedZone.nameServers,
        actualNameServers,
        domainRegistration,
      },
    };
  }

  const [aRecords, aaaaRecords, cnameRecords] = await Promise.all([
    lookupSafe(domain, "A"),
    lookupSafe(domain, "AAAA"),
    lookupSafe(domain, "CNAME"),
  ]);

  const wwwDomain = domain.startsWith("www.") ? domain : `www.${domain}`;
  const managedCloudFrontAliases = await findManagedCloudFrontAliases(
    hostedZone.id,
    [domain, wwwDomain]
  );
  const domainHasManagedA = hasManagedAlias(
    managedCloudFrontAliases,
    domain,
    "A"
  );
  const domainHasManagedAAAA = hasManagedAlias(
    managedCloudFrontAliases,
    domain,
    "AAAA"
  );
  const wwwHasManagedA = hasManagedAlias(
    managedCloudFrontAliases,
    wwwDomain,
    "A"
  );
  const wwwHasManagedAAAA = hasManagedAlias(
    managedCloudFrontAliases,
    wwwDomain,
    "AAAA"
  );
  const domainDnsRecordsAreManaged =
    cnameRecords.length === 0 &&
    (aRecords.length === 0 || domainHasManagedA) &&
    (aaaaRecords.length === 0 || domainHasManagedAAAA);

  if (
    (aRecords.length > 0 ||
      aaaaRecords.length > 0 ||
      cnameRecords.length > 0) &&
    !domainDnsRecordsAreManaged
  ) {
    return {
      domain,
      rootDomain,
      hostedZoneId: hostedZone.id,
      hostedZoneName: hostedZone.name,
      hostedZoneCreated,
      expectedNameServers: hostedZone.nameServers,
      actualNameServers,
      domainRegistration,
      status: "RECORD_CONFLICT",
      canProceed: false,
      details: {
        reason: "Existing DNS records found on requested hostname",
        aRecords,
        aaaaRecords,
        cnameRecords,
        managedCloudFrontAliases,
      },
    };
  }

  const [httpRoot, httpsRoot, httpWww, httpsWww] = await Promise.all([
    checkHttp(`http://${domain}`),
    checkHttp(`https://${domain}`),
    checkHttp(`http://www.${domain}`),
    checkHttp(`https://www.${domain}`),
  ]);

  const rootHttpIsManaged =
    (httpRoot.reachable || httpsRoot.reachable) &&
    (domainHasManagedA || domainHasManagedAAAA);
  const wwwHttpIsManaged =
    (httpWww.reachable || httpsWww.reachable) &&
    (wwwHasManagedA || wwwHasManagedAAAA);

  if (
    ((httpRoot.reachable || httpsRoot.reachable) && !rootHttpIsManaged) ||
    ((httpWww.reachable || httpsWww.reachable) && !wwwHttpIsManaged)
  ) {
    return {
      domain,
      rootDomain,
      hostedZoneId: hostedZone.id,
      hostedZoneName: hostedZone.name,
      hostedZoneCreated,
      expectedNameServers: hostedZone.nameServers,
      actualNameServers,
      domainRegistration,
      status: "HTTP_ACTIVE",
      canProceed: false,
      details: {
        reason: "HTTP/HTTPS endpoint already responds for this domain",
        httpRoot,
        httpsRoot,
        httpWww,
        httpsWww,
        managedCloudFrontAliases,
      },
    };
  }

  return {
    domain,
    rootDomain,
    hostedZoneId: hostedZone.id,
    hostedZoneName: hostedZone.name,
    hostedZoneCreated,
    expectedNameServers: hostedZone.nameServers,
    actualNameServers,
    domainRegistration,
    status: "AVAILABLE",
    canProceed: true,
    details: {
      aRecords,
      aaaaRecords,
      cnameRecords,
      domainRegistration,
      managedCloudFrontAliases,
    },
  };
}
