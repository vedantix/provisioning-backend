import dns from "node:dns/promises";
import axios from "axios";
import {
  Route53Client,
  ListHostedZonesByNameCommand,
  HostedZone,
} from "@aws-sdk/client-route-53";
import { parse } from "tldts";

export type DomainCheckStatus =
  | "AVAILABLE"
  | "INVALID"
  | "HOSTED_ZONE_NOT_FOUND"
  | "RECORD_CONFLICT"
  | "HTTP_ACTIVE";

export type DomainCheckResult = {
  domain: string;
  rootDomain: string;
  hostedZoneId?: string;
  hostedZoneName?: string;
  status: DomainCheckStatus;
  canProceed: boolean;
  details: Record<string, unknown>;
};

const route53 = new Route53Client({
  region: process.env.AWS_REGION,
});

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

async function findBestHostedZone(
  rootDomain: string
): Promise<{ id: string; name: string } | null> {
  const response = await route53.send(
    new ListHostedZonesByNameCommand({
      DNSName: rootDomain,
      MaxItems: 20,
    })
  );

  const zones = response.HostedZones ?? [];
  const wantedFqdn = rootDomain.endsWith(".") ? rootDomain : `${rootDomain}.`;

  const match = zones
    .filter((zone) => isMatchingHostedZone(zone, wantedFqdn))
    .sort((a, b) => (b.Name ?? "").length - (a.Name ?? "").length)[0];

  if (!match || !match.Id || !match.Name) {
    return null;
  }

  return {
    id: match.Id.replace("/hostedzone/", ""),
    name: match.Name,
  };
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
  const hostedZone = await findBestHostedZone(rootDomain);

  if (!hostedZone) {
    return {
      domain,
      rootDomain,
      status: "HOSTED_ZONE_NOT_FOUND",
      canProceed: false,
      details: {
        reason: `No Route53 hosted zone found for ${rootDomain}`,
      },
    };
  }

  const [aRecords, aaaaRecords, cnameRecords] = await Promise.all([
    lookupSafe(domain, "A"),
    lookupSafe(domain, "AAAA"),
    lookupSafe(domain, "CNAME"),
  ]);

  if (
    aRecords.length > 0 ||
    aaaaRecords.length > 0 ||
    cnameRecords.length > 0
  ) {
    return {
      domain,
      rootDomain,
      hostedZoneId: hostedZone.id,
      hostedZoneName: hostedZone.name,
      status: "RECORD_CONFLICT",
      canProceed: false,
      details: {
        reason: "Existing DNS records found on requested hostname",
        aRecords,
        aaaaRecords,
        cnameRecords,
      },
    };
  }

  const [httpRoot, httpsRoot, httpWww, httpsWww] = await Promise.all([
    checkHttp(`http://${domain}`),
    checkHttp(`https://${domain}`),
    checkHttp(`http://www.${domain}`),
    checkHttp(`https://www.${domain}`),
  ]);

  if (
    httpRoot.reachable ||
    httpsRoot.reachable ||
    httpWww.reachable ||
    httpsWww.reachable
  ) {
    return {
      domain,
      rootDomain,
      hostedZoneId: hostedZone.id,
      hostedZoneName: hostedZone.name,
      status: "HTTP_ACTIVE",
      canProceed: false,
      details: {
        reason: "HTTP/HTTPS endpoint already responds for this domain",
        httpRoot,
        httpsRoot,
        httpWww,
        httpsWww,
      },
    };
  }

  return {
    domain,
    rootDomain,
    hostedZoneId: hostedZone.id,
    hostedZoneName: hostedZone.name,
    status: "AVAILABLE",
    canProceed: true,
    details: {
      aRecords,
      aaaaRecords,
      cnameRecords,
    },
  };
}