import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

// Validate assertMongosyncRunnable's clear-error behaviour by mocking the resolved binary
// path and pointing it at real temp files (avoids the fragility of mocking the whole fs
// module, which other deps rely on). Own file so the resolve-bin mock doesn't collide with
// process-manager.test.ts's supervised-routing mocks.
const resolved = { value: "mongosync" };
vi.mock("@/lib/resolve-bin", () => ({
  resolveMongosyncBin: () => resolved.value,
  getMongosyncPath: () => resolved.value,
}));

async function load() {
  return await import("@/lib/process-manager");
}

let dir: string;
beforeEach(() => {
  vi.resetModules();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mongosync-ui-bin-"));
  resolved.value = "mongosync";
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("assertMongosyncRunnable", () => {
  it("accepts a bare 'mongosync' command (PATH lookup) without stat-ing", async () => {
    resolved.value = "mongosync";
    const { assertMongosyncRunnable } = await load();
    expect(() => assertMongosyncRunnable()).not.toThrow();
  });

  it("throws a clear error when an absolute path does not exist", async () => {
    resolved.value = path.join(dir, "nope", "mongosync");
    const { assertMongosyncRunnable } = await load();
    expect(() => assertMongosyncRunnable()).toThrow(/not found at/);
  });

  it("throws when the path is a directory", async () => {
    resolved.value = dir; // dir is an absolute path that is a directory
    const { assertMongosyncRunnable } = await load();
    expect(() => assertMongosyncRunnable()).toThrow(/is a directory/);
  });

  it("throws when the file is not executable", async () => {
    const f = path.join(dir, "mongosync");
    fs.writeFileSync(f, "#!/bin/sh\n", { mode: 0o644 });
    resolved.value = f;
    const { assertMongosyncRunnable } = await load();
    expect(() => assertMongosyncRunnable()).toThrow(/not executable/);
  });

  it("passes for an existing executable file", async () => {
    const f = path.join(dir, "mongosync");
    fs.writeFileSync(f, "#!/bin/sh\n", { mode: 0o755 });
    resolved.value = f;
    const { assertMongosyncRunnable } = await load();
    expect(() => assertMongosyncRunnable()).not.toThrow();
  });
});
