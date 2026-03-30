import { describe, it, expect } from "vitest";
import { buildDeployWorkflowFile } from "../../../src/services/deployment/deploy.service";

describe("buildDeployWorkflowFile", () => {
  it("contains workflow_dispatch", () => {
    const workflow = buildDeployWorkflowFile();
    expect(workflow).toContain("workflow_dispatch");
  });

  it("contains S3 sync step", () => {
    const workflow = buildDeployWorkflowFile();
    expect(workflow).toContain("aws s3 sync");
  });

  it("contains CloudFront invalidation step", () => {
    const workflow = buildDeployWorkflowFile();
    expect(workflow).toContain("aws cloudfront create-invalidation");
  });
});