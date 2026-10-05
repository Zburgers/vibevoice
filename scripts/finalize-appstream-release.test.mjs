import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { finalizeAppStreamRelease } from "./finalize-appstream-release.mjs";

const version = JSON.parse(readFileSync(new URL("../app/package.json", import.meta.url), "utf8")).version;
const xml = readFileSync(new URL("../app/src-tauri/linux/dev.zburgers.vibevoice.metainfo.xml", import.meta.url), "utf8");
const tag = `v${version}`;
const nextPatchTag = `v${version.replace(/(\d+)$/, (_, patch) => String(Number(patch) + 1))}`;

test("finalizes the draft entry with the actual build date and preserves component metadata", () => {
  const updated = finalizeAppStreamRelease(xml, tag, "2026-10-07");
  assert.ok(updated.includes(`<release version="${version}" date="2026-10-07" type="stable" />`));
  assert.equal(updated.replace(/<release\s+[^>]*\/>/, ""), xml.replace(/<release\s+[^>]*\/>/, ""));
});

test("rejects mismatched/duplicate versions and development tags before writing", () => {
  for (const invalidTag of [nextPatchTag, `${tag}-rc.1`, version, `${tag}\"bad`]) {
    assert.throws(() => finalizeAppStreamRelease(xml, invalidTag, "2026-10-07"));
  }
  assert.throws(() => finalizeAppStreamRelease(xml.replace("</releases>", `<release version="${version}" />\n</releases>`), tag, "2026-10-07"));
});

test("rejects missing/invalid dates", () => {
  for (const date of [undefined, "2026-02-30", "2026-13-01", "2026-10-7", ""]) {
    assert.throws(() => finalizeAppStreamRelease(xml, tag, date));
  }
});
