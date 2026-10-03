import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function finalizeAppStreamRelease(xml, tag, date) {
  const version = /^v(\d+\.\d+\.\d+)$/.exec(tag)?.[1];
  if (!version) throw new Error("Expected a stable release tag such as v0.2.8.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      Number.isNaN(Date.parse(`${date}T00:00:00Z`)) ||
      new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
    throw new Error("Expected a valid UTC release date in YYYY-MM-DD format.");
  }
  const entries = [...xml.matchAll(/<release\s+[^>]*\bversion="([^"]+)"[^>]*\/>/g)];
  const matching = entries.filter((entry) => entry[1] === version);
  if (matching.length !== 1) throw new Error(`Expected exactly one AppStream entry for ${version}.`);
  return xml.replace(matching[0][0], `<release version="${version}" date="${date}" type="stable" />`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [tag, date] = process.argv.slice(2);
  const metadata = new URL("../app/src-tauri/linux/dev.zburgers.vibevoice.metainfo.xml", import.meta.url);
  const updated = finalizeAppStreamRelease(readFileSync(metadata, "utf8"), tag, date);
  writeFileSync(metadata, updated);
  console.log(`AppStream metadata finalized for ${tag}, stable, ${date}.`);
}
