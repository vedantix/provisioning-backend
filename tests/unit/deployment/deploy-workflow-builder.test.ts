import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
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

function findFileRecursive(dir: string, matcher: (file: string) => boolean): string | null {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      const nested = findFileRecursive(fullPath, matcher);
      if (nested) {
        return nested;
      }
      continue;
    }

    if (entry.isFile() && matcher(entry.name)) {
      return fullPath;
    }
  }

  return null;
}

async function importBuilderModule() {
  const srcRoot = path.resolve(process.cwd(), "src");

  const filePath =
    findFileRecursive(
      srcRoot,
      (name) =>
        /deploy.*workflow.*builder/i.test(name) &&
        (name.endsWith(".ts") || name.endsWith(".js"))
    ) ||
    findFileRecursive(
      srcRoot,
      (name) =>
        /workflow.*builder/i.test(name) &&
        (name.endsWith(".ts") || name.endsWith(".js"))
    );

  if (!filePath) {
    throw new Error("Could not find deploy workflow builder file anywhere under src/");
  }

  return import(pathToFileURL(filePath).href);
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