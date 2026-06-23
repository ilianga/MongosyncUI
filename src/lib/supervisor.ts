import path from "path";
import fs from "fs";
import { getAllMigrations, getMigration, updateMigration } from "./db";
import { generateConfig } from "./config-generator";
import { resolveMongosyncBin } from "./resolve-bin";
import { getLogDir, getDataDir } from "./paths";
import { getSupervisionConfig } from "./supervision-config";
import { sessionName, sessionExists, startSession, killSession, listMsyncSessions } from "./tmux";
import type { Migration, WrapperStatus } from "./types";

const WRAPPER = path.resolve(process.cwd(), "scripts/mongosync-respawn.sh");

function supervisionDir(id: string): string {
  return path.join(getDataDir(), "supervision", id);
}

// Create the supervision directory on disk. Call this only at write sites
// (superviseStart before writing the sentinel, superviseStop before writing sentinel).
function ensureSupervisionDir(id: string): void {
  try {
    fs.mkdirSync(supervisionDir(id), { recursive: true });
  } catch (e) {
    throw new Error(`Could not create supervision directory ${supervisionDir(id)}: ${(e as Error).message}`);
  }
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
  // Ensure directory exists before any file writes for this migration.
  ensureSupervisionDir(migration.id);
  // Clear any stale stop sentinel so the wrapper does not immediately exit.
  fs.rmSync(stopSentinelPath(migration.id), { force: true });
  if (!sessionExists(name)) startSession(name, buildWrapperCommand(migration));
  updateMigration(migration.id, { desiredRunning: 1, supervisionStatus: "running" });
}

export function superviseStop(id: string, opts: { intentional?: boolean } = {}): void {
  const name = sessionName(id);
  // Default/intentional path: set desiredRunning=0, write the stop sentinel, then kill —
  // so the wrapper never respawns and reconcile() will not restart it on the next tick.
  // Passing { intentional: false } force-kills the session while leaving desiredRunning=1,
  // so reconcile() WILL restart it — used by hung-restart paths.
  if (opts.intentional !== false) {
    // Order matters: intent → sentinel → kill. A crash mid-way self-heals via reconcile.
    // desiredRunning=0 is set FIRST so even if the sentinel write fails, reconcile() will
    // not restart the session; the kill below still runs to actually stop the process.
    updateMigration(id, { desiredRunning: 0 });
    try {
      ensureSupervisionDir(id);
      fs.writeFileSync(stopSentinelPath(id), "");
    } catch {
      /* sentinel is belt-and-suspenders; desiredRunning=0 + kill already stop it */
    }
  }
  killSession(name);
  updateMigration(id, { supervisionStatus: "stopped" });
}

export function retrySupervision(id: string): void {
  fs.rmSync(statusPath(id), { force: true });
  updateMigration(id, { restartCount: 0, lastExitCode: null, supervisionStatus: "running", desiredRunning: 1 });
  const fresh = getMigration(id);
  if (fresh) superviseStart(fresh);
}

// Idempotent: drive every migration toward its desired state. Safe to call repeatedly
// (each poll tick, on startup, after reboot). This is the single recovery path.
export function reconcile(): void {
  const migrations = getAllMigrations();
  const known = new Set(migrations.map((m) => sessionName(m.id)));

  for (const m of migrations) {
    // Per-migration isolation: a failure recovering one migration (e.g. a config write
    // error or a missing binary in superviseStart) must not stop the others from being
    // reconciled. Record the failure on the row and move on.
    try {
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
          if (fresh) {
            superviseStart(fresh);
            // superviseStart sets status "running"; override to "restarting" so the UI
            // can show that this was an automatic recovery rather than an initial start.
            updateMigration(m.id, { supervisionStatus: "restarting", lastRestartAt: Date.now() });
          }
          // If fresh === undefined the migration was deleted mid-reconcile — skip silently.
        } else if (m.supervisionStatus !== "running") {
          updateMigration(m.id, { supervisionStatus: "running" });
        }
      } else if (sessionExists(name)) {
        killSession(name);
        updateMigration(m.id, { supervisionStatus: "stopped" });
      }
    } catch {
      // Leave the row's status as-is (no "error" state exists in the model) and let the
      // next reconcile tick retry. The failure is isolated to this migration.
    }
  }

  // Sweep orphan sessions whose migration row is gone (e.g. deleted while app was down).
  for (const s of listMsyncSessions()) {
    if (!known.has(s)) {
      try { killSession(s); } catch { /* best effort */ }
    }
  }
}
