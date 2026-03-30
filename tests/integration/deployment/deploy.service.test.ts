import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:dns/promises", () => {
  return {
    default: {
      resolveCname: vi.fn(),
    },
  };
});

vi.mock("../../../src/services/domain/domain-check.service", () => ({
  checkDomainAvailability: vi.fn(),
}));

vi.mock("../../../src/services/github/github-provision.service", () => ({
  provisionRepository: vi.fn(),
}));

vi.mock("../../../src/services/github/github.service", () => ({
  dispatchDeploymentWorkflow: vi.fn(),
}));

vi.mock("../../../src/services/plan/plan-resolver.service", () => ({
  resolvePlan: vi.fn(() => ({ code: "STARTER" })),
}));

vi.mock("../../../src/services/aws/s3.service", () => ({
  createCustomerBucket: vi.fn(),
  ensureCloudFrontReadAccess: vi.fn(),
}));

vi.mock("../../../src/services/aws/acm.service", () => ({
  requestCertificate: vi.fn(),
  getCertificateValidationRecords: vi.fn(),
  waitForCertificateIssued: vi.fn(),
}));

vi.mock("../../../src/services/aws/route53.service", () => ({
  upsertDnsValidationRecord: vi.fn(),
  upsertCloudFrontAliasRecords: vi.fn(),
}));

vi.mock("../../../src/services/aws/cloudfront.service", () => ({
  createDistribution: vi.fn(),
}));

vi.mock("../../../src/services/aws/dynamodb.service", () => ({
  putDeployment: vi.fn(),
  putJob: vi.fn(),
  updateDeployment: vi.fn(),
  updateJob: vi.fn(),
  getJobById: vi.fn(() => ({ currentStage: "DOMAIN_CHECK" })),
}));

vi.mock("../../../src/services/aws/sqs.service", () => ({
  queueJob: vi.fn(),
}));

import dns from "node:dns/promises";

import { deployWebsite } from "../../../src/services/deployment/deploy.service";
import { checkDomainAvailability } from "../../../src/services/domain/domain-check.service";
import { provisionRepository } from "../../../src/services/github/github-provision.service";
import { dispatchDeploymentWorkflow } from "../../../src/services/github/github.service";
import { createCustomerBucket } from "../../../src/services/aws/s3.service";
import {
  requestCertificate,
  getCertificateValidationRecords,
  waitForCertificateIssued,
} from "../../../src/services/aws/acm.service";
import {
  upsertDnsValidationRecord,
  upsertCloudFrontAliasRecords,
} from "../../../src/services/aws/route53.service";
import { createDistribution } from "../../../src/services/aws/cloudfront.service";
import { queueJob } from "../../../src/services/aws/sqs.service";

describe("deploy.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(dns.resolveCname).mockImplementation(async (name: string) => {
      if (name.includes("_abc.test1.vedantix.nl")) {
        return ["_target.acm-validations.aws."];
      }

      if (name.includes("_def.www.test1.vedantix.nl")) {
        return ["_target2.acm-validations.aws."];
      }

      return [];
    });

    vi.mocked(checkDomainAvailability).mockResolvedValue({
      domain: "test1.vedantix.nl",
      rootDomain: "vedantix.nl",
      hostedZoneId: "Z123",
      status: "AVAILABLE",
      canProceed: true,
      details: {},
    });

    vi.mocked(provisionRepository).mockResolvedValue({
      success: true,
      stage: "DONE",
      repo: "vedantix-test-project-1",
      url: "https://github.com/vedantix/vedantix-test-project-1",
      created: true,
      filesCreated: 1,
      workflowExists: true,
      details: {},
      defaultBranch: "main",
    } as any);

    vi.mocked(createCustomerBucket).mockResolvedValue({
      bucketName: "vedantix-test1-vedantix-nl",
      region: "eu-west-1",
      existed: false,
      bucketRegionalDomainName: "bucket.s3.eu-west-1.amazonaws.com",
    } as any);

    vi.mocked(requestCertificate).mockResolvedValue("arn:test-cert");

    vi.mocked(getCertificateValidationRecords).mockResolvedValue([
      {
        domainName: "test1.vedantix.nl",
        name: "_abc.test1.vedantix.nl.",
        type: "CNAME",
        value: "_target.acm-validations.aws.",
      },
      {
        domainName: "www.test1.vedantix.nl",
        name: "_def.www.test1.vedantix.nl.",
        type: "CNAME",
        value: "_target2.acm-validations.aws.",
      },
    ] as any);

    vi.mocked(upsertDnsValidationRecord).mockResolvedValue({
      name: "_abc.test1.vedantix.nl",
      type: "CNAME",
      hostedZoneId: "Z123",
      upserted: true,
    });

    vi.mocked(waitForCertificateIssued).mockResolvedValue();

    vi.mocked(createDistribution).mockResolvedValue({
      distributionId: "D123",
      arn: "arn:cloudfront:D123",
      domainName: "d123.cloudfront.net",
      aliases: ["test1.vedantix.nl", "www.test1.vedantix.nl"],
      created: true,
      updated: false,
      oacId: "oac_123",
    } as any);

    vi.mocked(upsertCloudFrontAliasRecords).mockResolvedValue({
      hostedZoneId: "Z123",
      cloudFrontDomainName: "d123.cloudfront.net",
      upsertedDomains: ["test1.vedantix.nl", "www.test1.vedantix.nl"],
    });

    vi.mocked(dispatchDeploymentWorkflow).mockResolvedValue({
      success: true,
      details: {},
    } as any);

    vi.mocked(queueJob).mockResolvedValue("msg_123");
  });

  it("completes happy path deploy", async () => {
    const result = await deployWebsite({
      customerId: "cust_1",
      projectName: "vedantix-test-project-1",
      domain: "test1.vedantix.nl",
      packageCode: "STARTER",
      addOns: [],
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe("SUCCEEDED");
    expect(queueJob).toHaveBeenCalled();
  });

  it("fails when domain is not available", async () => {
    vi.mocked(checkDomainAvailability).mockResolvedValue({
      domain: "test1.vedantix.nl",
      rootDomain: "vedantix.nl",
      status: "RECORD_CONFLICT",
      canProceed: false,
      details: {},
    } as any);

    await expect(
      deployWebsite({
        customerId: "cust_1",
        projectName: "vedantix-test-project-1",
        domain: "test1.vedantix.nl",
        packageCode: "STARTER",
        addOns: [],
      })
    ).rejects.toThrow(/Domain check failed/);
  });

  it("fails when github provisioning fails", async () => {
    vi.mocked(provisionRepository).mockResolvedValue({
      success: false,
      stage: "GITHUB_REPOSITORY",
      error: "Bad credentials",
    } as any);

    await expect(
      deployWebsite({
        customerId: "cust_1",
        projectName: "vedantix-test-project-1",
        domain: "test1.vedantix.nl",
        packageCode: "STARTER",
        addOns: [],
      })
    ).rejects.toThrow(/GitHub provisioning failed/);
  });

  it("fails when ACM validation records are missing", async () => {
    vi.mocked(getCertificateValidationRecords).mockResolvedValue([]);

    await expect(
      deployWebsite({
        customerId: "cust_1",
        projectName: "vedantix-test-project-1",
        domain: "test1.vedantix.nl",
        packageCode: "STARTER",
        addOns: [],
      })
    ).rejects.toThrow(/no DNS validation records/i);
  });
});