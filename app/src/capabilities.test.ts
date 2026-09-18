import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const capability = (name: string) => JSON.parse(readFileSync(resolve(process.cwd(), "src-tauri/capabilities", name), "utf8")) as { permissions: string[] };

describe("packaged capability policy", () => {
  it("splits audited main and pill permissions", () => {
    const main = capability("main.json");
    const pill = capability("pill.json");
    expect(main.permissions).not.toContain("core:default");
    expect(pill.permissions).not.toContain("core:default");
    expect(main.permissions).toContain("core:event:allow-listen");
    expect(main.permissions).toContain("core:event:allow-unlisten");
    expect(pill.permissions).toContain("core:event:allow-listen");
    expect(pill.permissions).toContain("core:event:allow-unlisten");
    expect(main.permissions).toContain("updater:default");
    expect(main.permissions).toContain("process:allow-restart");
    expect(pill.permissions).not.toContain("updater:default");
    expect(pill.permissions).not.toContain("process:allow-restart");
    expect(pill.permissions).not.toContain("clipboard-manager:allow-write-text");
  });
});
