import { compare, valid } from "semver";

export function normalizeReleaseVersion(value: string): string | null {
  const normalized = value.trim().replace(/^v/i, "");
  return valid(normalized) ?? null;
}

export function compareReleaseVersions(left: string, right: string): number | null {
  const leftVersion = normalizeReleaseVersion(left);
  const rightVersion = normalizeReleaseVersion(right);
  if (!leftVersion || !rightVersion) return null;
  return compare(leftVersion, rightVersion);
}

