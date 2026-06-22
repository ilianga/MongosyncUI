import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "path";
import fs from "fs";
import os from "os";
import type { ProgressResponse } from "@/lib/process-manager";

const supervisor = { reconcile: vi.fn(), readWrapperStatus: vi.fn(() => null) };
const tmux = { sessionName: (id: string) => `msync-${id}`, sessionExists: vi.fn(() => true), killSession: vi.fn() };
const pm = { fetchProgress: vi.fn(), sendCommand: vi.fn(), isProcessAlive: vi.fn(() => true) };

vi.mock("@/lib/supervisor", () => supervisor);
vi.mock("@/lib/tmux", () => tmux);
vi.mock("@/lib/process-manager", () => pm);
vi.mock("@/lib/config-generator", () => ({ buildStartBody: () => ({ source: "cluster0", destination: "cluster1" }) }));

let dir: string, prevEnv: string | undefined;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mongosync-ui-test-"));
  prevEnv = process.env.MONGOSYNC_UI_DIR; process.env.MONGOSYNC_UI_DIR = dir;
  vi.resetModules();
  [supervisor.reconcile, pm.fetchProgress, pm.sendCommand, tmux.killSession].forEach((f) => f.mockReset());
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
    for (let i = 0; i < 6; i++) await pollOnce(); // default hungTicks = 6
    expect(tmux.killSession).toHaveBeenCalledWith(`msync-${id}`);
  });

  it("re-issues /start when a supervised migration comes up IDLE (resume)", async () => {
    await withRunningMigration();
    pm.fetchProgress.mockResolvedValue({ success: true, progress: { state: "IDLE", canCommit: false, canWrite: false } });
    const { pollOnce } = await import("@/lib/poller");
    await pollOnce();
    expect(pm.sendCommand).toHaveBeenCalledWith(27182, "start", expect.anything());
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
});
