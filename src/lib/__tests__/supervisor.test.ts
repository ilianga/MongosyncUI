import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "path";
import fs from "fs";
import os from "os";

const tmux = {
  sessionName: (id: string) => `msync-${id}`,
  sessionExists: vi.fn(),
  startSession: vi.fn(),
  killSession: vi.fn(),
  listMsyncSessions: vi.fn(() => [] as string[]),
};
vi.mock("@/lib/tmux", () => tmux);
vi.mock("@/lib/config-generator", () => ({ generateConfig: () => "/tmp/cfg.yaml" }));
vi.mock("@/lib/resolve-bin", () => ({ resolveMongosyncBin: () => "/usr/bin/mongosync", getMongosyncPath: () => "/usr/bin/mongosync" }));

let testDir: string;
let originalEnv: string | undefined;

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), "mongosync-ui-test-"));
  originalEnv = process.env.MONGOSYNC_UI_DIR;
  process.env.MONGOSYNC_UI_DIR = testDir;
  vi.resetModules();
  Object.values(tmux).forEach((f) => typeof f === "function" && (f as ReturnType<typeof vi.fn>).mockReset?.());
  tmux.sessionName = (id: string) => `msync-${id}`;
  tmux.listMsyncSessions.mockReturnValue([]);
});
afterEach(() => {
  process.env.MONGOSYNC_UI_DIR = originalEnv;
  fs.rmSync(testDir, { recursive: true, force: true });
});

async function setup() {
  const db = await import("@/lib/db");
  const sup = await import("@/lib/supervisor");
  return { db, sup };
}

describe("supervisor", () => {
  it("superviseStart sets desiredRunning and starts a session when none exists", async () => {
    const { db, sup } = await setup();
    const m = db.createMigration({ name: "m", sourceUri: "mongodb://a", destUri: "mongodb://b", config: {}, port: 27182 });
    tmux.sessionExists.mockReturnValue(false);
    sup.superviseStart(db.getMigration(m.id)!);
    expect(tmux.startSession).toHaveBeenCalledWith(`msync-${m.id}`, expect.stringContaining("mongosync-respawn.sh"));
    expect(db.getMigration(m.id)!.desiredRunning).toBe(1);
    expect(db.getMigration(m.id)!.supervisionStatus).toBe("running");
  });

  it("superviseStop(intentional) writes the stop sentinel BEFORE killing the session", async () => {
    const { db, sup } = await setup();
    const m = db.createMigration({ name: "m", sourceUri: "mongodb://a", destUri: "mongodb://b", config: {}, port: 27182 });
    db.updateMigration(m.id, { desiredRunning: 1 });

    // Track call order: spy on fs.writeFileSync and killSession to assert sentinel is written first.
    const callOrder: string[] = [];
    const sentinelPath = sup.stopSentinelPath(m.id);
    const origWriteFileSync = fs.writeFileSync.bind(fs);
    const writeFileSpy = vi.spyOn(fs, "writeFileSync").mockImplementation((...args: Parameters<typeof fs.writeFileSync>) => {
      if (args[0] === sentinelPath) callOrder.push("writeSentinel");
      return origWriteFileSync(...args);
    });
    tmux.killSession.mockImplementation(() => { callOrder.push("killSession"); });

    sup.superviseStop(m.id, { intentional: true });

    writeFileSpy.mockRestore();

    expect(fs.existsSync(sentinelPath)).toBe(true);
    expect(tmux.killSession).toHaveBeenCalledWith(`msync-${m.id}`);
    expect(db.getMigration(m.id)!.desiredRunning).toBe(0);
    expect(db.getMigration(m.id)!.supervisionStatus).toBe("stopped");

    // Critical ordering assertion: sentinel must be written before killSession.
    const sentinelIdx = callOrder.indexOf("writeSentinel");
    const killIdx = callOrder.indexOf("killSession");
    expect(sentinelIdx).toBeGreaterThanOrEqual(0);
    expect(killIdx).toBeGreaterThanOrEqual(0);
    expect(sentinelIdx).toBeLessThan(killIdx);
  });

  it("reconcile recreates a missing session for a desired-running migration", async () => {
    const { db, sup } = await setup();
    const m = db.createMigration({ name: "m", sourceUri: "mongodb://a", destUri: "mongodb://b", config: {}, port: 27182 });
    db.updateMigration(m.id, { desiredRunning: 1 });
    tmux.sessionExists.mockReturnValue(false);
    sup.reconcile();
    expect(tmux.startSession).toHaveBeenCalled();
    expect(db.getMigration(m.id)!.supervisionStatus).toBe("restarting");
  });

  it("reconcile marks crash_looping and kills the session when the wrapper gave up", async () => {
    const { db, sup } = await setup();
    const m = db.createMigration({ name: "m", sourceUri: "mongodb://a", destUri: "mongodb://b", config: {}, port: 27182 });
    db.updateMigration(m.id, { desiredRunning: 1 });
    const sPath = sup.statusPath(m.id);
    fs.mkdirSync(path.dirname(sPath), { recursive: true });
    fs.writeFileSync(sPath, JSON.stringify({ attempt: 5, lastExitCode: 7, lastStartAt: 1, state: "crash_looping" }));
    tmux.sessionExists.mockReturnValue(true);
    sup.reconcile();
    expect(db.getMigration(m.id)!.supervisionStatus).toBe("crash_looping");
    expect(db.getMigration(m.id)!.lastExitCode).toBe(7);
    expect(tmux.killSession).toHaveBeenCalledWith(`msync-${m.id}`);
  });

  it("reconcile kills sessions for migrations that should not be running", async () => {
    const { db, sup } = await setup();
    const m = db.createMigration({ name: "m", sourceUri: "mongodb://a", destUri: "mongodb://b", config: {}, port: 27182 });
    // desiredRunning defaults to 0
    tmux.sessionExists.mockReturnValue(true);
    sup.reconcile();
    expect(tmux.killSession).toHaveBeenCalledWith(`msync-${m.id}`);
  });

  it("reconcile sweeps orphan msync sessions with no matching migration", async () => {
    const { sup } = await setup();
    tmux.listMsyncSessions.mockReturnValue(["msync-ghost"]);
    tmux.sessionExists.mockReturnValue(false);
    sup.reconcile();
    expect(tmux.killSession).toHaveBeenCalledWith("msync-ghost");
  });

  it("reconcile leaves a desiredRunning=1 migration untouched when its session already exists and status is 'running'", async () => {
    const { db, sup } = await setup();
    const m = db.createMigration({ name: "m", sourceUri: "mongodb://a", destUri: "mongodb://b", config: {}, port: 27182 });
    db.updateMigration(m.id, { desiredRunning: 1, supervisionStatus: "running" });
    // Session exists — reconcile should neither start nor kill anything.
    tmux.sessionExists.mockReturnValue(true);
    sup.reconcile();
    expect(tmux.startSession).not.toHaveBeenCalled();
    expect(tmux.killSession).not.toHaveBeenCalled();
  });
});
