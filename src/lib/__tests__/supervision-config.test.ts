import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "path";
import fs from "fs";
import os from "os";

let testDir: string;
let originalEnv: string | undefined;

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), "mongosync-ui-test-"));
  originalEnv = process.env.MONGOSYNC_UI_DIR;
  process.env.MONGOSYNC_UI_DIR = testDir;
  vi.resetModules();
});

afterEach(() => {
  process.env.MONGOSYNC_UI_DIR = originalEnv;
  fs.rmSync(testDir, { recursive: true, force: true });
});

describe("getSupervisionConfig", () => {
  it("returns defaults when nothing is set", async () => {
    const { getSupervisionConfig } = await import("@/lib/supervision-config");
    expect(getSupervisionConfig()).toEqual({
      mode: "supervised",
      backoffCapSec: 60,
      crashLoopMax: 5,
      crashLoopWindowSec: 300,
      hungTicks: 6,
    });
  });

  it("reads overrides from settings and clamps invalid numbers to defaults", async () => {
    const { setSetting } = await import("@/lib/db");
    setSetting("supervisionMode", "legacy");
    setSetting("backoffCapSec", "30");
    setSetting("hungTicks", "not-a-number");
    const { getSupervisionConfig } = await import("@/lib/supervision-config");
    const cfg = getSupervisionConfig();
    expect(cfg.mode).toBe("legacy");
    expect(cfg.backoffCapSec).toBe(30);
    expect(cfg.hungTicks).toBe(6); // invalid → default
  });
});
