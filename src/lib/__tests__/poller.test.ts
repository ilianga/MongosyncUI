import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "path";
import fs from "fs";
import os from "os";
import type { ProgressResponse } from "@/lib/process-manager";
import { getSupervisionConfig } from "@/lib/supervision-config";

const supervisor = { reconcile: vi.fn(), readWrapperStatus: vi.fn(() => null) };
const tmux = { sessionName: (id: string) => `msync-${id}`, sessionExists: vi.fn(() => true), killSession: vi.fn() };
const pm = { fetchProgress: vi.fn(), sendCommand: vi.fn(), isProcessAlive: vi.fn(() => true) };

const resourceStats = { getProcessStats: vi.fn(async () => null) };

vi.mock("@/lib/supervisor", () => supervisor);
vi.mock("@/lib/tmux", () => tmux);
vi.mock("@/lib/process-manager", () => pm);
vi.mock("@/lib/config-generator", () => ({ buildStartBody: () => ({ source: "cluster0", destination: "cluster1" }) }));
vi.mock("@/lib/resource-stats", () => resourceStats);

let dir: string, prevEnv: string | undefined;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mongosync-ui-test-"));
  prevEnv = process.env.MONGOSYNC_UI_DIR; process.env.MONGOSYNC_UI_DIR = dir;
  vi.resetModules();
  [supervisor.reconcile, pm.fetchProgress, pm.sendCommand, tmux.killSession].forEach((f) => f.mockReset());
  resourceStats.getProcessStats.mockReset();
  resourceStats.getProcessStats.mockResolvedValue(null);
  tmux.sessionExists.mockReturnValue(true);
});
afterEach(() => { process.env.MONGOSYNC_UI_DIR = prevEnv; fs.rmSync(dir, { recursive: true, force: true }); });

async function withRunningMigration() {
  const db = await import("@/lib/db");
  const m = db.createMigration({ name: "m", sourceUri: "mongodb://a", destUri: "mongodb://b", config: {}, port: 27182 });
  db.updateMigration(m.id, { state: "RUNNING", desiredRunning: 1 });
  return { db, id: m.id };
}

describe("pollOnce health monitoring", () => {
  it("always reconciles first", async () => {
    await withRunningMigration();
    pm.fetchProgress.mockResolvedValue({ success: true, progress: { state: "RUNNING", canCommit: false, canWrite: false } });
    const { pollOnce } = await import("@/lib/poller");
    await pollOnce();
    expect(supervisor.reconcile).toHaveBeenCalled();
  });

  it("restarts a hung migration after hungTicks unreachable probes", async () => {
    const { id } = await withRunningMigration();
    pm.fetchProgress.mockRejectedValue(new Error("ECONNREFUSED"));
    const { pollOnce } = await import("@/lib/poller");
    // Drive exactly hungTicks iterations so the test stays correct if the default changes.
    const { hungTicks } = getSupervisionConfig();
    for (let i = 0; i < hungTicks; i++) await pollOnce();
    expect(tmux.killSession).toHaveBeenCalledWith(`msync-${id}`);
  });

  it("re-issues /start when a supervised RUNNING migration comes up IDLE (resume)", async () => {
    // state must be RUNNING in the DB — that is the guard that allows resume.
    await withRunningMigration(); // sets state: "RUNNING", desiredRunning: 1
    pm.fetchProgress.mockResolvedValue({ success: true, progress: { state: "IDLE", canCommit: false, canWrite: false } });
    const { pollOnce } = await import("@/lib/poller");
    await pollOnce();
    expect(pm.sendCommand).toHaveBeenCalledWith(27182, "start", expect.anything());
  });

  it("does NOT re-issue /start when a supervised PAUSED migration comes up IDLE after crash", async () => {
    // A user-paused migration (state PAUSED, desiredRunning 1) must not be auto-resumed.
    const db = await import("@/lib/db");
    const m = db.createMigration({ name: "m", sourceUri: "mongodb://a", destUri: "mongodb://b", config: {}, port: 27182 });
    db.updateMigration(m.id, { state: "PAUSED", desiredRunning: 1 });
    pm.fetchProgress.mockResolvedValue({ success: true, progress: { state: "IDLE", canCommit: false, canWrite: false } });
    const { pollOnce } = await import("@/lib/poller");
    await pollOnce();
    expect(pm.sendCommand).not.toHaveBeenCalledWith(27182, "start", expect.anything());
  });

  it("clears pid for a legacy (unsupervised) migration whose process is dead", async () => {
    const db = await import("@/lib/db");
    const m = db.createMigration({ name: "m", sourceUri: "mongodb://a", destUri: "mongodb://b", config: {}, port: 27182 });
    // Legacy: desiredRunning=0, state RUNNING (active states polled), pid set but process dead.
    db.updateMigration(m.id, { state: "RUNNING", desiredRunning: 0, pid: 999999999 });
    pm.isProcessAlive.mockReturnValue(false);
    const { pollOnce } = await import("@/lib/poller");
    await pollOnce();
    // pid should be cleared; fetchProgress should NOT have been called.
    expect(pm.fetchProgress).not.toHaveBeenCalled();
    expect(db.getMigration(m.id)!.pid).toBeNull();
  });
});

// ── Original progressToMetric tests (kept intact) ────────────────────────────

async function load() {
  return await import("@/lib/poller");
}

const sample: ProgressResponse = {
  success: true,
  progress: {
    state: "RUNNING",
    canCommit: true,
    canWrite: false,
    lagTimeSeconds: 3,
    totalEventsApplied: 1000,
    estimatedSecondsToCEACatchup: 12,
    collectionCopy: { estimatedCopiedBytes: 5000, estimatedTotalBytes: 10000 },
    indexBuilding: { indexesBuilt: 2, totalIndexesToBuild: 8 },
    source: { pingLatencyMs: 15 },
    destination: { pingLatencyMs: 22 },
  },
};

describe("progressToMetric", () => {
  it("derives copyProgress from bytes and maps fields", async () => {
    const { progressToMetric } = await load();
    const m = progressToMetric("mig1", sample);
    expect(m.migrationId).toBe("mig1");
    expect(m.state).toBe("RUNNING");
    expect(m.copyProgress).toBe(50);
    expect(m.estimatedCopiedBytes).toBe(5000);
    expect(m.lagTimeSeconds).toBe(3);
    expect(m.totalEventsApplied).toBe(1000);
    expect(m.estimatedSecondsToCEACatchup).toBe(12);
    expect(m.indexesBuilt).toBe(2);
    expect(m.totalIndexesToBuild).toBe(8);
    expect(m.sourcePingMs).toBe(15);
    expect(m.destPingMs).toBe(22);
  });

  it("defaults copyProgress to 0 when total bytes is 0 or missing", async () => {
    const { progressToMetric } = await load();
    const m = progressToMetric("mig1", { success: true, progress: { state: "RUNNING", canCommit: false, canWrite: false } });
    expect(m.copyProgress).toBe(0);
    expect(m.indexesBuilt).toBe(0);
    expect(m.sourcePingMs).toBeNull();
  });

  it("defaults the OS resource fields to null (merged in later by probe)", async () => {
    const { progressToMetric } = await load();
    const m = progressToMetric("mig1", sample);
    expect(m.cpuPercent).toBeNull();
    expect(m.rssBytes).toBeNull();
    expect(m.uptimeSec).toBeNull();
  });

  it("records canCommit as 1/0", async () => {
    const { progressToMetric } = await load();
    expect(progressToMetric("mig1", sample).canCommit).toBe(1);
    expect(
      progressToMetric("mig1", { success: true, progress: { state: "RUNNING", canCommit: false, canWrite: false } }).canCommit
    ).toBe(0);
  });

  it("uses the stable plannedTotalBytes denominator instead of mongosync's estimate", async () => {
    const { progressToMetric } = await load();
    // mongosync underestimates total at 10000 (would read 50%); planned total is the real 50000.
    const m = progressToMetric("mig1", sample, 50000);
    expect(m.copyProgress).toBe(10); // 5000 / 50000
    expect(m.estimatedTotalBytes).toBe(10000); // raw mongosync value still preserved
  });

  it("clamps copyProgress to 100 when copied exceeds the planned total", async () => {
    const { progressToMetric } = await load();
    const m = progressToMetric("mig1", sample, 4000); // copied 5000 > planned 4000
    expect(m.copyProgress).toBe(100);
  });

  it("falls back to mongosync's total when planned total is null or zero", async () => {
    const { progressToMetric } = await load();
    expect(progressToMetric("mig1", sample, null).copyProgress).toBe(50);
    expect(progressToMetric("mig1", sample, 0).copyProgress).toBe(50);
  });
});
