import { describe, expect, it } from "vitest";
import { compareReleaseVersions, normalizeReleaseVersion } from "./version";

describe("release SemVer", () => {
  it("accepts v prefixes and build metadata", () => {
    expect(normalizeReleaseVersion("v0.2.7+linux")).toBe("0.2.7");
    expect(compareReleaseVersions("v1.0.0+build.2", "1.0.0+build.1")).toBe(0);
  });

  it("orders prereleases before their stable release", () => {
    expect(compareReleaseVersions("1.0.0-alpha", "1.0.0-alpha.1")).toBeLessThan(0);
    expect(compareReleaseVersions("1.0.0-rc.1", "1.0.0")).toBeLessThan(0);
    expect(compareReleaseVersions("1.0.0", "1.0.0-rc.1")).toBeGreaterThan(0);
  });

  it("rejects malformed or incomplete values", () => {
    expect(normalizeReleaseVersion("latest")).toBeNull();
    expect(compareReleaseVersions("1.0", "1.0.0")).toBeNull();
    expect(compareReleaseVersions("1.0.0.1", "1.0.0")).toBeNull();
  });
});
