import { describe, it, expect } from "vitest";
import {
  normalizeDomain,
  buildBucketNameFromDomain,
  buildCertificateDomains,
  toRootAndWwwDomains,
} from "../../../src/utils/domain.util";

describe("domain.util", () => {
  it("normalizes a domain", () => {
    expect(normalizeDomain("https://Test1.Vedantix.nl/")).toBe(
      "test1.vedantix.nl"
    );
  });

  it("builds a bucket name from domain", () => {
    expect(buildBucketNameFromDomain("test1.vedantix.nl")).toBe(
      "vedantix-test1-vedantix-nl"
    );
  });

  it("builds certificate domains", () => {
    expect(buildCertificateDomains("test1.vedantix.nl")).toEqual({
      rootDomain: "test1.vedantix.nl",
      subjectAlternativeNames: ["www.test1.vedantix.nl"],
    });
  });

  it("returns root and www domains", () => {
    expect(toRootAndWwwDomains("test1.vedantix.nl")).toEqual([
      "test1.vedantix.nl",
      "www.test1.vedantix.nl",
    ]);
  });
});