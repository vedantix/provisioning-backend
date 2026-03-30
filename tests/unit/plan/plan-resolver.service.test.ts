import { describe, it, expect } from "vitest";
import { resolvePlan } from "../../../src/services/plan/plan-resolver.service";

describe("plan-resolver.service", () => {
  it("resolves STARTER without addons", () => {
    const result = resolvePlan("STARTER", []);
    expect(result).toBeDefined();
  });

  it("resolves GROWTH with addons", () => {
    const result = resolvePlan("GROWTH", ["MAILBOX"] as any);
    expect(result).toBeDefined();
  });

  it("returns a stable plan shape", () => {
    const result = resolvePlan("PRO", []);
    expect(result).toEqual(expect.any(Object));
  });
});