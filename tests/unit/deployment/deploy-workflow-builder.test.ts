import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.AWS_REGION = process.env.AWS_REGION || "eu-west-1";
  process.env.AWS_ACCOUNT_ID = process.env.AWS_ACCOUNT_ID || "123456789012";
  process.env.AWS_DEPLOY_ROLE_ARN =
    process.env.AWS_DEPLOY_ROLE_ARN ||
    "arn:aws:iam::123456789012:role/test-deploy-role";
  process.env.GITHUB_TOKEN = process.env.GITHUB_TOKEN || "test-github-token";
  process.env.GITHUB_OWNER = process.env.GITHUB_OWNER || "vedantix";
  process.env.S3_BUCKET_PREFIX = process.env.S3_BUCKET_PREFIX || "vedantix";
  process.env.CLOUDFRONT_PRICE_CLASS =
    process.env.CLOUDFRONT_PRICE_CLASS || "PriceClass_100";
});

async function importBuilderModule() {
  const candidates = [
    "../../../src/services/deployment/deploy-workflow-builder",
    "../../../src/services/deployment/deploy-workflow-builder.service",
    "../../../src/services/github/deploy-workflow-builder",
    "../../../src/services/github/deploy-workflow-builder.service",
    "../../../src/services/github/workflow-builder",
    "../../../src/services/github/workflow-builder.service",
    "../../../src/services/github/workflow/deploy-workflow-builder",
    "../../../src/services/github/workflow/deploy-workflow-builder.service",
  ];

  for (const path of candidates) {
    try {
      return await import(path);
    } catch {
      // try next
    }
  }

  throw new Error(
    `Could not find deploy workflow builder module. Checked: ${candidates.join(", ")}`
  );
}

function pickBuilder(mod: Record<string, unknown>) {
  const candidates = [
    mod.buildDeployWorkflow,
    mod.createDeployWorkflow,
    mod.buildWorkflow,
    mod.default,
  ];

  const builder = candidates.find((value) => typeof value === "function");

  if (!builder) {
    throw new Error(
      `No workflow builder export found. Available exports: ${Object.keys(mod).join(", ")}`
    );
  }

  return builder as (input: Record<string, unknown>) => string;
}

describe("deploy workflow builder", () => {
  it("builds workflow yaml", async () => {
    const mod = await importBuilderModule();
    const buildDeployWorkflow = pickBuilder(mod);

    const yaml = buildDeployWorkflow({
      bucket: "vedantix-test-bucket",
      distributionId: "E123456789",
      mode: "deploy",
      targetRef: "",
    });

    expect(typeof yaml).toBe("string");
    expect(yaml).toContain("workflow_dispatch");
    expect(yaml).toContain("vedantix-test-bucket");
    expect(yaml).toContain("E123456789");
  });
});