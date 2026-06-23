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

async function loadDb() {
  return await import("@/lib/db");
}

describe("db", () => {
  it("creates tables on first access", async () => {
    const { getDb } = await loadDb();
    const names = (getDb()
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[]).map((t) => t.name);
    expect(names).toContain("migrations");
    expect(names).toContain("metrics");
    expect(names).toContain("settings");
  });

  it("creates, retrieves, and lists migrations", async () => {
    const { createMigration, getMigration, getAllMigrations } = await loadDb();
    const m = createMigration({
      name: "test",
      sourceUri: "mongodb://src:27017",
      destUri: "mongodb://dst:27017",
      config: { reversible: true },
      port: 27182,
    });
    expect(m.id).toBeTruthy();
    expect(m.state).toBe("IDLE");
    expect(m.pid).toBeNull();
    expect(getMigration(m.id)).toEqual(m);
    expect(getAllMigrations()).toHaveLength(1);
  });

  it("updates and deletes a migration", async () => {
    const { createMigration, updateMigration, getMigration, deleteMigration } = await loadDb();
    const m = createMigration({
      name: "m", sourceUri: "mongodb://a", destUri: "mongodb://b", config: {}, port: 27182,
    });
    updateMigration(m.id, { state: "RUNNING", pid: 12345 });
    const updated = getMigration(m.id)!;
    expect(updated.state).toBe("RUNNING");
    expect(updated.pid).toBe(12345);
    deleteMigration(m.id);
    expect(getMigration(m.id)).toBeUndefined();
  });

  it("inserts and retrieves metrics, cascading on delete", async () => {
    const { createMigration, insertMetric, getMetrics, deleteMigration } = await loadDb();
    const m = createMigration({
      name: "m", sourceUri: "mongodb://a", destUri: "mongodb://b", config: {}, port: 27182,
    });
    insertMetric({
      migrationId: m.id, state: "RUNNING", copyProgress: 42.5, canCommit: 1,
      estimatedCopiedBytes: 5000, estimatedTotalBytes: 10000,
      lagTimeSeconds: 3, totalEventsApplied: 1000, estimatedSecondsToCEACatchup: 12,
      indexesBuilt: 1, totalIndexesToBuild: 4, sourcePingMs: 12, destPingMs: 20,
      cpuPercent: 7.5, rssBytes: 1048576, uptimeSec: 120,
    });
    const metrics = getMetrics(m.id);
    expect(metrics).toHaveLength(1);
    expect(metrics[0].copyProgress).toBe(42.5);
    expect(metrics[0].canCommit).toBe(1);
    expect(metrics[0].indexesBuilt).toBe(1);
    expect(metrics[0].cpuPercent).toBe(7.5);
    expect(metrics[0].rssBytes).toBe(1048576);
    expect(metrics[0].uptimeSec).toBe(120);
    deleteMigration(m.id);
    expect(getMetrics(m.id)).toHaveLength(0);
  });

  it("gets and sets settings (upsert)", async () => {
    const { getSetting, setSetting } = await loadDb();
    expect(getSetting("mongosyncPath")).toBeUndefined();
    setSetting("mongosyncPath", "/usr/local/bin/mongosync");
    expect(getSetting("mongosyncPath")).toBe("/usr/local/bin/mongosync");
    setSetting("mongosyncPath", "/opt/mongosync");
    expect(getSetting("mongosyncPath")).toBe("/opt/mongosync");
  });

  it("creates migrations with supervision defaults", async () => {
    const { createMigration } = await loadDb();
    const m = createMigration({
      name: "m", sourceUri: "mongodb://a", destUri: "mongodb://b", config: {}, port: 27182,
    });
    expect(m.desiredRunning).toBe(0);
    expect(m.supervisionStatus).toBe("stopped");
    expect(m.restartCount).toBe(0);
    expect(m.lastExitCode).toBeNull();
    expect(m.lastRestartAt).toBeNull();
  });

  it("persists supervision field updates", async () => {
    const { createMigration, updateMigration, getMigration } = await loadDb();
    const m = createMigration({
      name: "m", sourceUri: "mongodb://a", destUri: "mongodb://b", config: {}, port: 27182,
    });
    updateMigration(m.id, { desiredRunning: 1, supervisionStatus: "running", restartCount: 2, lastExitCode: 9 });
    const u = getMigration(m.id)!;
    expect(u.desiredRunning).toBe(1);
    expect(u.supervisionStatus).toBe("running");
    expect(u.restartCount).toBe(2);
    expect(u.lastExitCode).toBe(9);
  });
});
