import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { finalizeAppStreamRelease } from "./finalize-appstream-release.mjs";

const xml = readFileSync(new URL("../app/src-tauri/linux/dev.zburgers.vibevoice.metainfo.xml", import.meta.url), "utf8");

test("finalizes the draft entry with the actual build date and preserves component metadata", () => {
  const updated = finalizeAppStreamRelease(xml, "v0.2.8", "2026-10-07");
  assert.ok(updated.includes('<release version="0.2.8" date="2026-10-07" type="stable" />'));
  assert.equal(updated.replace(/<release\s+[^>]*\/>/, ""), xml.replace(/<release\s+[^>]*\/>/, ""));
});

test("rejects mismatched/duplicate versions and development tags before writing", () => {
  for (const tag of ["v0.2.9", "v0.2.8-rc.1", "0.2.8", "v0.2.8\"bad"]) {
    assert.throws(() => finalizeAppStreamRelease(xml, tag, "2026-10-07"));
  }
  assert.throws(() => finalizeAppStreamRelease(xml.replace("</releases>", '<release version="0.2.8" />\n</releases>'), "v0.2.8", "2026-10-07"));
});

test("rejects missing/invalid dates", () => {
  for (const date of [undefined, "2026-02-30", "2026-13-01", "2026-10-7", ""]) {
    assert.throws(() => finalizeAppStreamRelease(xml, "v0.2.8", date));
  }
});
