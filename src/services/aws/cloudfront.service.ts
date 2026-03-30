import {
  CloudFrontClient,
  CreateDistributionCommand,
  CreateOriginAccessControlCommand,
  GetDistributionConfigCommand,
  ListDistributionsCommand,
  ListOriginAccessControlsCommand,
  UpdateDistributionCommand,
  DistributionSummary,
  OriginAccessControlSummary,
  DistributionConfig,
  PriceClass,
  HttpVersion,
  DeleteDistributionCommand,
  ViewerProtocolPolicy,
  SSLSupportMethod,
  MinimumProtocolVersion
} from '@aws-sdk/client-cloudfront';

const cloudfront = new CloudFrontClient({
  region: 'us-east-1'
});

type CreateDistributionParams = {
  bucketRegionalDomainName: string;
  domainNames: string[];
  certificateArn: string;
};

type CloudFrontDistributionResult = {
  distributionId: string;
  domainName: string;
  arn: string;
  aliases: string[];
  created: boolean;
  updated: boolean;
  oacId: string;
};

function normalizeAliases(domainNames: string[]): string[] {
  return [...new Set(domainNames.map((d) => d.trim().toLowerCase()).filter(Boolean))].sort();
}

function buildOacName(bucketRegionalDomainName: string): string {
  return `vedantix-oac-${bucketRegionalDomainName.replace(/[^a-z0-9-]/gi, '-')}`.slice(0, 64);
}

function buildOriginId(bucketRegionalDomainName: string): string {
  return `s3-${bucketRegionalDomainName}`;
}

function aliasesExactlyMatch(summary: DistributionSummary, aliases: string[]): boolean {
  const existing = [...(summary.Aliases?.Items ?? [])].map((d) => d.toLowerCase()).sort();
  const expected = [...aliases].map((d) => d.toLowerCase()).sort();

  if (existing.length !== expected.length) {
    return false;
  }

  return existing.every((value, index) => value === expected[index]);
}

function aliasesOverlap(summary: DistributionSummary, aliases: string[]): boolean {
  const existing = new Set((summary.Aliases?.Items ?? []).map((d) => d.toLowerCase()));
  return aliases.some((alias) => existing.has(alias.toLowerCase()));
}

async function listAllDistributions(): Promise<DistributionSummary[]> {
  const items: DistributionSummary[] = [];
  let marker: string | undefined;

  do {
    const result = await cloudfront.send(
      new ListDistributionsCommand({
        Marker: marker
      })
    );

    if (result.DistributionList?.Items?.length) {
      items.push(...result.DistributionList.Items);
    }

    marker = result.DistributionList?.NextMarker;
  } while (marker);

  return items;
}

async function listAllOriginAccessControls(): Promise<OriginAccessControlSummary[]> {
  const items: OriginAccessControlSummary[] = [];
  let marker: string | undefined;

  do {
    const result = await cloudfront.send(
      new ListOriginAccessControlsCommand({
        Marker: marker
      })
    );

    if (result.OriginAccessControlList?.Items?.length) {
      items.push(...result.OriginAccessControlList.Items);
    }

    marker = result.OriginAccessControlList?.NextMarker;
  } while (marker);

  return items;
}

async function ensureOriginAccessControl(
  bucketRegionalDomainName: string
): Promise<{ id: string; name: string }> {
  const expectedName = buildOacName(bucketRegionalDomainName);
  const existing = await listAllOriginAccessControls();

  const found = existing.find((item) => item.Name === expectedName);

  if (found?.Id) {
    return {
      id: found.Id,
      name: found.Name ?? expectedName
    };
  }

  const created = await cloudfront.send(
    new CreateOriginAccessControlCommand({
      OriginAccessControlConfig: {
        Name: expectedName,
        Description: `Vedantix OAC for ${bucketRegionalDomainName}`,
        OriginAccessControlOriginType: 's3',
        SigningBehavior: 'always',
        SigningProtocol: 'sigv4'
      }
    })
  );

  const id = created.OriginAccessControl?.Id;

  if (!id) {
    throw new Error(`Failed to create Origin Access Control for ${bucketRegionalDomainName}`);
  }

  return {
    id,
    name: expectedName
  };
}

async function findDistributionByAliases(
  aliases: string[]
): Promise<DistributionSummary | null> {
  const all = await listAllDistributions();

  const exact = all.find((distribution) => aliasesExactlyMatch(distribution, aliases));
  if (exact) {
    return exact;
  }

  const overlapping = all.find((distribution) => aliasesOverlap(distribution, aliases));
  if (overlapping) {
    return overlapping;
  }

  return null;
}

function buildDistributionConfig(params: {
  bucketRegionalDomainName: string;
  domainNames: string[];
  certificateArn: string;
  oacId: string;
  callerReference: string;
}): DistributionConfig {
  const aliases = normalizeAliases(params.domainNames);
  const originId = buildOriginId(params.bucketRegionalDomainName);
  const primaryDomain = aliases[0];

  return {
    CallerReference: params.callerReference,
    Comment: `Vedantix distribution for ${primaryDomain}`,
    Enabled: true,
    DefaultRootObject: 'index.html',
    PriceClass: PriceClass.PriceClass_100,
    HttpVersion: HttpVersion.http2,
    IsIPV6Enabled: true,
    Aliases: {
      Quantity: aliases.length,
      Items: aliases
    },
    Origins: {
      Quantity: 1,
      Items: [
        {
          Id: originId,
          DomainName: params.bucketRegionalDomainName,
          S3OriginConfig: {
            OriginAccessIdentity: ''
          },
          OriginAccessControlId: params.oacId
        }
      ]
    },
    DefaultCacheBehavior: {
      TargetOriginId: originId,
      ViewerProtocolPolicy: ViewerProtocolPolicy.redirect_to_https,
      Compress: true,
      AllowedMethods: {
        Quantity: 2,
        Items: ['GET', 'HEAD'],
        CachedMethods: {
          Quantity: 2,
          Items: ['GET', 'HEAD']
        }
      },
      CachePolicyId: '658327ea-f89d-4fab-a63d-7e88639e58f6'
    },
    CustomErrorResponses: {
      Quantity: 2,
      Items: [
        {
          ErrorCode: 403,
          ResponsePagePath: '/index.html',
          ResponseCode: '200',
          ErrorCachingMinTTL: 0
        },
        {
          ErrorCode: 404,
          ResponsePagePath: '/index.html',
          ResponseCode: '200',
          ErrorCachingMinTTL: 0
        }
      ]
    },
    ViewerCertificate: {
      ACMCertificateArn: params.certificateArn,
      SSLSupportMethod: SSLSupportMethod.sni_only,
      MinimumProtocolVersion: MinimumProtocolVersion.TLSv1_2_2021
    }
  };
}

function buildUpdatedDistributionConfig(params: {
  currentConfig: DistributionConfig;
  bucketRegionalDomainName: string;
  domainNames: string[];
  certificateArn: string;
  oacId: string;
}): DistributionConfig {
  const aliases = normalizeAliases(params.domainNames);
  const originId = buildOriginId(params.bucketRegionalDomainName);
  const primaryDomain = aliases[0];

  return {
    ...params.currentConfig,
    Comment: `Vedantix distribution for ${primaryDomain}`,
    Enabled: true,
    DefaultRootObject: 'index.html',
    PriceClass: PriceClass.PriceClass_100,
    HttpVersion: HttpVersion.http2,
    IsIPV6Enabled: true,
    Aliases: {
      Quantity: aliases.length,
      Items: aliases
    },
    Origins: {
      Quantity: 1,
      Items: [
        {
          Id: originId,
          DomainName: params.bucketRegionalDomainName,
          S3OriginConfig: {
            OriginAccessIdentity: ''
          },
          OriginAccessControlId: params.oacId
        }
      ]
    },
    DefaultCacheBehavior: {
      ...params.currentConfig.DefaultCacheBehavior,
      TargetOriginId: originId,
      ViewerProtocolPolicy: ViewerProtocolPolicy.redirect_to_https,
      Compress: true,
      AllowedMethods: {
        Quantity: 2,
        Items: ['GET', 'HEAD'],
        CachedMethods: {
          Quantity: 2,
          Items: ['GET', 'HEAD']
        }
      },
      CachePolicyId: '658327ea-f89d-4fab-a63d-7e88639e58f6'
    },
    CustomErrorResponses: {
      Quantity: 2,
      Items: [
        {
          ErrorCode: 403,
          ResponsePagePath: '/index.html',
          ResponseCode: '200',
          ErrorCachingMinTTL: 0
        },
        {
          ErrorCode: 404,
          ResponsePagePath: '/index.html',
          ResponseCode: '200',
          ErrorCachingMinTTL: 0
        }
      ]
    },
    ViewerCertificate: {
      ACMCertificateArn: params.certificateArn,
      SSLSupportMethod: SSLSupportMethod.sni_only,
      MinimumProtocolVersion: MinimumProtocolVersion.TLSv1_2_2021
    }
  };
}

function ensureAliasesDoNotConflict(
  existing: DistributionSummary,
  requestedAliases: string[]
): void {
  const existingAliases = existing.Aliases?.Items ?? [];
  const lowerExistingAliases = existingAliases.map((d) => d.toLowerCase());

  const hasOverlap = requestedAliases.some((alias) =>
    lowerExistingAliases.includes(alias.toLowerCase())
  );

  if (!hasOverlap) {
    return;
  }

  const existingId = existing.Id ?? 'unknown';

  throw new Error(
    `One or more aliases are already attached to CloudFront distribution ${existingId}.`
  );
}

export async function createDistribution(
  params: CreateDistributionParams
): Promise<CloudFrontDistributionResult> {
  const aliases = normalizeAliases(params.domainNames);

  if (!aliases.length) {
    throw new Error('At least one domain name is required for CloudFront distribution');
  }

  const primaryDomain = aliases[0];
  const oac = await ensureOriginAccessControl(params.bucketRegionalDomainName);
  const existing = await findDistributionByAliases(aliases);

  if (!existing) {
    const createResult = await cloudfront.send(
      new CreateDistributionCommand({
        DistributionConfig: buildDistributionConfig({
          bucketRegionalDomainName: params.bucketRegionalDomainName,
          domainNames: aliases,
          certificateArn: params.certificateArn,
          oacId: oac.id,
          callerReference: `${Date.now()}-${primaryDomain}`
        })
      })
    );

    const distribution = createResult.Distribution;

    if (!distribution?.Id || !distribution.DomainName || !distribution.ARN) {
      throw new Error(`Failed to create CloudFront distribution for ${primaryDomain}`);
    }

    return {
      distributionId: distribution.Id,
      domainName: distribution.DomainName,
      arn: distribution.ARN,
      aliases,
      created: true,
      updated: false,
      oacId: oac.id
    };
  }

  const existingId = existing.Id;

  if (!existingId) {
    throw new Error(`Found CloudFront distribution without Id for aliases: ${aliases.join(', ')}`);
  }

  const existingAliases = normalizeAliases(existing.Aliases?.Items ?? []);
  const exactAliasMatch =
    existingAliases.length === aliases.length &&
    existingAliases.every((value, index) => value === aliases[index]);

  if (!exactAliasMatch) {
    ensureAliasesDoNotConflict(existing, aliases);
  }

  const currentConfigResult = await cloudfront.send(
    new GetDistributionConfigCommand({
      Id: existingId
    })
  );

  const currentConfig = currentConfigResult.DistributionConfig;
  const eTag = currentConfigResult.ETag;

  if (!currentConfig || !eTag) {
    throw new Error(`Failed to load current CloudFront config for distribution ${existingId}`);
  }

  const updatedConfig = buildUpdatedDistributionConfig({
    currentConfig,
    bucketRegionalDomainName: params.bucketRegionalDomainName,
    domainNames: aliases,
    certificateArn: params.certificateArn,
    oacId: oac.id
  });

  const updateResult = await cloudfront.send(
    new UpdateDistributionCommand({
      Id: existingId,
      IfMatch: eTag,
      DistributionConfig: updatedConfig
    })
  );

  const distribution = updateResult.Distribution;

  if (!distribution?.Id || !distribution.DomainName || !distribution.ARN) {
    throw new Error(`Failed to update CloudFront distribution ${existingId}`);
  }

  return {
    distributionId: distribution.Id,
    domainName: distribution.DomainName,
    arn: distribution.ARN,
    aliases,
    created: false,
    updated: true,
    oacId: oac.id
  };
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function disableAndDeleteDistribution(
  distributionId: string
): Promise<{
  distributionId: string;
  deleted: true;
}> {
  const currentConfigResult = await cloudfront.send(
    new GetDistributionConfigCommand({
      Id: distributionId
    })
  );

  const currentConfig = currentConfigResult.DistributionConfig;
  let eTag = currentConfigResult.ETag;

  if (!currentConfig || !eTag) {
    throw new Error(`Failed to load current CloudFront config for distribution ${distributionId}`);
  }

  if (currentConfig.Enabled) {
    const disableResult = await cloudfront.send(
      new UpdateDistributionCommand({
        Id: distributionId,
        IfMatch: eTag,
        DistributionConfig: {
          ...currentConfig,
          Enabled: false
        }
      })
    );

    eTag = disableResult.ETag;

    if (!eTag) {
      throw new Error(`Missing ETag after disabling CloudFront distribution ${distributionId}`);
    }

    let disabled = false;

    for (let attempt = 0; attempt < 40; attempt += 1) {
      await wait(15000);

      const configResult = await cloudfront.send(
        new GetDistributionConfigCommand({
          Id: distributionId
        })
      );

      const distributionResult = await cloudfront.send(
        new GetDistributionConfigCommand({
          Id: distributionId
        })
      );

      eTag = configResult.ETag;

      if (
        distributionResult.DistributionConfig &&
        distributionResult.DistributionConfig.Enabled === false
      ) {
        disabled = true;
        break;
      }
    }

    if (!disabled) {
      throw new Error(`Timed out while waiting for CloudFront distribution ${distributionId} to disable`);
    }
  }

  if (!eTag) {
    const refreshed = await cloudfront.send(
      new GetDistributionConfigCommand({
        Id: distributionId
      })
    );

    eTag = refreshed.ETag;
  }

  if (!eTag) {
    throw new Error(`Missing ETag before deleting CloudFront distribution ${distributionId}`);
  }

  await cloudfront.send(
    new DeleteDistributionCommand({
      Id: distributionId,
      IfMatch: eTag
    })
  );

  return {
    distributionId,
    deleted: true
  };
}

export async function disableDistribution(
  distributionId: string
): Promise<{
  distributionId: string;
  disabled: true;
  eTag?: string;
}> {
  const currentConfigResult = await cloudfront.send(
    new GetDistributionConfigCommand({
      Id: distributionId
    })
  );

  const currentConfig = currentConfigResult.DistributionConfig;
  const eTag = currentConfigResult.ETag;

  if (!currentConfig || !eTag) {
    throw new Error(`Failed to load current CloudFront config for distribution ${distributionId}`);
  }

  if (!currentConfig.Enabled) {
    return {
      distributionId,
      disabled: true,
      eTag,
    };
  }

  const disableResult = await cloudfront.send(
    new UpdateDistributionCommand({
      Id: distributionId,
      IfMatch: eTag,
      DistributionConfig: {
        ...currentConfig,
        Enabled: false
      }
    })
  );

  return {
    distributionId,
    disabled: true,
    eTag: disableResult.ETag,
  };
}

export async function waitForDistributionDisabled(
  distributionId: string,
  maxAttempts = 40,
  delayMs = 15000
): Promise<{
  distributionId: string;
  status: 'DISABLED';
  eTag?: string;
}> {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await cloudfront.send(
      new GetDistributionConfigCommand({
        Id: distributionId
      })
    );

    if (result.DistributionConfig && result.DistributionConfig.Enabled === false) {
      return {
        distributionId,
        status: 'DISABLED',
        eTag: result.ETag,
      };
    }

    if (attempt < maxAttempts) {
      await wait(delayMs);
    }
  }

  throw new Error(`Timed out while waiting for CloudFront distribution ${distributionId} to disable`);
}