import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

let testDir: string;
let binDir: string;
let originalEnv: string | undefined;

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), "mongosync-ui-bin-"));
  binDir = path.join(testDir, "bin");
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, "mongosync"), "#!/bin/sh\n", { mode: 0o755 });
  originalEnv = process.env.MONGOSYNC_UI_DIR;
  process.env.MONGOSYNC_UI_DIR = testDir;
  vi.resetModules();
});

afterEach(() => {
  process.env.MONGOSYNC_UI_DIR = originalEnv;
  fs.rmSync(testDir, { recursive: true, force: true });
});

async function load() {
  const db = await import("@/lib/db");
  const pm = await import("@/lib/process-manager");
  return { ...db, ...pm };
}

describe("resolveMongosyncBin", () => {
  it("defaults to 'mongosync' on PATH when unset", async () => {
    const { resolveMongosyncBin } = await load();
    expect(resolveMongosyncBin()).toBe("mongosync");
  });

  it("appends the binary name when given a directory", async () => {
    const { setSetting, resolveMongosyncBin } = await load();
    setSetting("mongosyncPath", binDir);
    expect(resolveMongosyncBin()).toBe(path.join(binDir, "mongosync"));
  });

  it("appends the binary name when the path has a trailing slash", async () => {
    const { setSetting, resolveMongosyncBin } = await load();
    setSetting("mongosyncPath", binDir + "/");
    expect(resolveMongosyncBin()).toBe(path.join(binDir, "mongosync"));
  });

  it("uses the path as-is when it points at the executable file", async () => {
    const { setSetting, resolveMongosyncBin } = await load();
    const file = path.join(binDir, "mongosync");
    setSetting("mongosyncPath", file);
    expect(resolveMongosyncBin()).toBe(file);
  });
});
