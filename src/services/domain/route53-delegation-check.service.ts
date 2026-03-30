import dns from "node:dns/promises";
import {
  Route53Client,
  GetHostedZoneCommand,
} from "@aws-sdk/client-route-53";
import { env } from "../../config/env";

const route53 = new Route53Client({ region: env.awsRegion });

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

export async function checkHostedZoneDelegation(params: {
  hostedZoneId: string;
  rootDomain: string;
}): Promise<{
  rootDomain: string;
  hostedZoneId: string;
  expectedNameServers: string[];
  actualNameServers: string[];
  delegated: boolean;
}> {
  const zone = await route53.send(
    new GetHostedZoneCommand({
      Id: params.hostedZoneId,
    })
  );

  const expectedNameServers = (zone.DelegationSet?.NameServers ?? [])
    .map(normalize)
    .sort();

  const actualNameServers = (await dns.resolveNs(params.rootDomain))
    .map(normalize)
    .sort();

  const delegated =
    expectedNameServers.length > 0 &&
    expectedNameServers.length === actualNameServers.length &&
    expectedNameServers.every((ns, index) => ns === actualNameServers[index]);

  return {
    rootDomain: params.rootDomain,
    hostedZoneId: params.hostedZoneId,
    expectedNameServers,
    actualNameServers,
    delegated,
  };
}