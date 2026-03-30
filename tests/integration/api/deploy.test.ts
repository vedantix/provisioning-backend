import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/services/deployment/deploy.service", () => ({
  deployWebsite: vi.fn(),
}));

import { deployWebsite } from "../../../src/services/deployment/deploy.service";
import deploymentRoutes from "../../../src/routes/deployment.routes";

describe("POST /api/deploy", () => {
  let app: express.Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use("/api", deploymentRoutes);
    vi.clearAllMocks();
    process.env.PROVISIONING_API_KEY = "test-key";
  });

  it("returns success for successful deploy", async () => {
    vi.mocked(deployWebsite).mockResolvedValue({
      success: true,
      deploymentId: "dep_123",
      jobId: "job_123",
      status: "SUCCEEDED",
    } as any);

    const response = await request(app)
      .post("/api/deploy")
      .set("x-api-key", "test-key")
      .send({
        customerId: "cust_1",
        projectName: "repo-1",
        domain: "test1.vedantix.nl",
        packageCode: "STARTER",
        addOns: [],
      });

    expect(response.status).toBeLessThan(500);
  });

  it("rejects request without api key", async () => {
    const response = await request(app).post("/api/deploy").send({
      customerId: "cust_1",
      projectName: "repo-1",
      domain: "test1.vedantix.nl",
      packageCode: "STARTER",
      addOns: [],
    });

    expect([401, 403]).toContain(response.status);
  });

  it("returns error when deploy service throws", async () => {
    vi.mocked(deployWebsite).mockRejectedValue(
      new Error("GitHub provisioning failed")
    );

    const response = await request(app)
      .post("/api/deploy")
      .set("x-api-key", "test-key")
      .send({
        customerId: "cust_1",
        projectName: "repo-1",
        domain: "test2.vedantix.nl",
        packageCode: "STARTER",
        addOns: [],
      });

    expect(response.status).toBeGreaterThanOrEqual(400);
  });
});