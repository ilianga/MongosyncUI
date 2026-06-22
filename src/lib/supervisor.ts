import path from "path";
import fs from "fs";
import { getAllMigrations, getMigration, updateMigration } from "./db";
import { generateConfig } from "./config-generator";
import { resolveMongosyncBin } from "./process-manager";
import { getLogDir, getDataDir } from "./paths";
import { getSupervisionConfig } from "./supervision-config";
import { sessionName, sessionExists, startSession, killSession, listMsyncSessions } from "./tmux";
import type { Migration, WrapperStatus } from "./types";

const WRAPPER = path.resolve(process.cwd(), "scripts/mongosync-respawn.sh");

function supervisionDir(id: string): string {
  const dir = path.join(getDataDir(), "supervision", id);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function statusPath(id: string): string {
  return path.join(supervisionDir(id), "status.json");
}

export function stopSentinelPath(id: string): string {
  return path.join(supervisionDir(id), "stop");
}

// Minimal POSIX single-quote escaping so paths with spaces survive tmux's shell.
function q(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

export function buildWrapperCommand(migration: Migration): string {
  const bin = resolveMongosyncBin();
  const config = generateConfig(migration);
  const logDir = getLogDir(migration.id);
  const cfg = getSupervisionConfig();
  return [
    q(WRAPPER), q(bin), q(config), q(logDir),
    q(statusPath(migration.id)), q(stopSentinelPath(migration.id)),
    cfg.backoffCapSec, cfg.crashLoopMax, cfg.crashLoopWindowSec,
  ].join(" ");
}

export function readWrapperStatus(id: string): WrapperStatus | null {
  try {
    const raw = fs.readFileSync(statusPath(id), "utf-8").trim();
    if (!raw) return null;
    const last = raw.split("\n").pop()!;
    return JSON.parse(last) as WrapperStatus;
  } catch {
    return null;
  }
}

export function superviseStart(migration: Migration): void {
  const name = sessionName(migration.id);
  // Clear any stale stop sentinel so the wrapper does not immediately exit.
  fs.rmSync(stopSentinelPath(migration.id), { force: true });
  if (!sessionExists(name)) startSession(name, buildWrapperCommand(migration));
  updateMigration(migration.id, { desiredRunning: 1, supervisionStatus: "running" });
}

export function superviseStop(id: string, opts: { intentional?: boolean } = {}): void {
  const name = sessionName(id);
  if (opts.intentional !== false) {
    // Order matters: intent → sentinel → kill. A crash mid-way self-heals via reconcile.
    updateMigration(id, { desiredRunning: 0 });
    fs.writeFileSync(stopSentinelPath(id), "");
  }
  killSession(name);
  updateMigration(id, { supervisionStatus: "stopped" });
}

// Idempotent: drive every migration toward its desired state. Safe to call repeatedly
// (each poll tick, on startup, after reboot). This is the single recovery path.
export function reconcile(): void {
  const migrations = getAllMigrations();
  const known = new Set(migrations.map((m) => sessionName(m.id)));

  for (const m of migrations) {
    const name = sessionName(m.id);
    if (m.desiredRunning) {
      const status = readWrapperStatus(m.id);
      if (status?.state === "crash_looping") {
        updateMigration(m.id, {
          supervisionStatus: "crash_looping",
          restartCount: status.attempt,
          lastExitCode: status.lastExitCode,
        });
        killSession(name);
        continue;
      }
      if (!sessionExists(name)) {
        const fresh = getMigration(m.id);
        if (fresh) superviseStart(fresh);
        updateMigration(m.id, { supervisionStatus: "restarting", lastRestartAt: Date.now() });
      } else if (m.supervisionStatus !== "running") {
        updateMigration(m.id, { supervisionStatus: "running" });
      }
    } else if (sessionExists(name)) {
      killSession(name);
      updateMigration(m.id, { supervisionStatus: "stopped" });
    }
  }

  // Sweep orphan sessions whose migration row is gone (e.g. deleted while app was down).
  for (const s of listMsyncSessions()) {
    if (!known.has(s)) killSession(s);
  }
}
