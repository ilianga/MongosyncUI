import { spawn } from "node:child_process";
import fs from "fs";
import path from "path";
import type { Migration } from "./types";
import { generateConfig } from "./config-generator";
import { getLogDir } from "./paths";
import { updateMigration } from "./db";
import { resolveMongosyncBin, getMongosyncPath } from "./resolve-bin";
import { hasTmux } from "./tmux";
import { getSupervisionConfig } from "./supervision-config";
import { superviseStart, superviseStop } from "./supervisor";

export { resolveMongosyncBin } from "./resolve-bin";

// Mirrors GET /api/v1/progress. All numeric fields optional — mongosync omits
// them depending on phase. The poller normalizes to the Metric shape.
export interface ProgressResponse {
  success: boolean;
  error?: string;
  errorDescription?: string;
  progress?: {
    state: string;
    canCommit: boolean;
    canWrite: boolean;
    info?: string;
    lagTimeSeconds?: number | null;
    totalEventsApplied?: number;
    estimatedSecondsToCEACatchup?: number;
    estimatedOplogTimeRemaining?: string;
    collectionCopy?: { estimatedCopiedBytes?: number; estimatedTotalBytes?: number };
    indexBuilding?: {
      indexesBuilt?: number;
      totalIndexesToBuild?: number;
      collectionsFinished?: number;
      collectionsTotal?: number;
    };
    directionMapping?: { Source?: string; Destination?: string };
    source?: { pingLatencyMs?: number };
    destination?: { pingLatencyMs?: number };
    mongosyncID?: string;
    coordinatorID?: string;
    warnings?: string[];
    verification?: {
      source?: VerificationSide;
      destination?: VerificationSide;
    };
  };
}

export interface VerificationSide {
  phase?: string;
  estimatedDocumentCount?: number;
  hashedDocumentCount?: number;
  scannedCollectionCount?: number;
  totalCollectionCount?: number;
  lagTimeSeconds?: number;
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate the configured mongosync binary before attempting to launch it, so a
 * misconfigured path produces a clear, actionable error at the call site instead of a
 * silent async spawn failure (detached spawns surface ENOENT on a later 'error' event,
 * never synchronously). Only an absolute/relative path can be stat-checked; the bare
 * "mongosync" (PATH lookup) is accepted and validated by the spawn itself.
 */
export function assertMongosyncRunnable(): void {
  const bin = resolveMongosyncBin();
  // Bare command name → resolved via PATH at spawn time; nothing to stat here.
  if (!bin.includes("/")) return;
  let stat: fs.Stats;
  try {
    stat = fs.statSync(bin);
  } catch {
    throw new Error(
      `mongosync binary not found at "${bin}". Set the correct path in Settings, or leave it blank to use mongosync on PATH.`
    );
  }
  if (stat.isDirectory()) {
    throw new Error(`mongosync path "${bin}" is a directory, not the executable.`);
  }
  try {
    fs.accessSync(bin, fs.constants.X_OK);
  } catch {
    throw new Error(`mongosync binary at "${bin}" is not executable (chmod +x it, or fix the path).`);
  }
}

function legacySpawn(migration: Migration): number {
  assertMongosyncRunnable();
  let configPath: string;
  try {
    configPath = generateConfig(migration);
  } catch (e) {
    throw new Error(`Failed to write mongosync config for migration ${migration.id}: ${(e as Error).message}`);
  }
  const logDir = getLogDir(migration.id);
  let outFd: number;
  let errFd: number;
  try {
    outFd = fs.openSync(path.join(logDir, "stdout.log"), "a");
    errFd = fs.openSync(path.join(logDir, "stderr.log"), "a");
  } catch (e) {
    throw new Error(`Failed to open mongosync log files in ${logDir}: ${(e as Error).message}`);
  }
  let child;
  try {
    child = spawn(getMongosyncPath(), ["--config", configPath], {
      detached: true,
      stdio: ["ignore", outFd, errFd],
    });
  } finally {
    // Close parent's copies of the FDs — child already inherited them. Always run,
    // even if spawn throws, so we don't leak descriptors.
    try { fs.closeSync(outFd); } catch { /* already closed */ }
    try { fs.closeSync(errFd); } catch { /* already closed */ }
  }
  if (!child.pid) throw new Error("Failed to spawn mongosync (binary not found or not executable?)");
  child.unref();
  updateMigration(migration.id, { pid: child.pid, supervisionStatus: "unsupervised" });
  return child.pid;
}

export function spawnMongosync(migration: Migration): number {
  const supervised = getSupervisionConfig().mode === "supervised" && hasTmux();
  if (supervised) {
    // Validate up front so a bad binary path surfaces clearly here rather than as a
    // crash-looping tmux session the user has to dig logs to diagnose.
    assertMongosyncRunnable();
    superviseStart(migration);
    return 0; // pid is informational only under supervision; identity is the session name
  }
  return legacySpawn(migration);
}

export function killMongosync(migration: Migration): void {
  const supervised = getSupervisionConfig().mode === "supervised" && hasTmux();
  if (supervised) {
    superviseStop(migration.id, { intentional: true });
    return;
  }
  if (migration.pid && isProcessAlive(migration.pid)) {
    try { process.kill(migration.pid, "SIGTERM"); } catch { /* already gone */ }
  }
  updateMigration(migration.id, { pid: null });
}

/**
 * Best-effort reason a freshly-spawned mongosync failed to come up, read from the
 * tail of its stdout log. mongosync prints concise causes there, e.g.
 * "(NotAReplicaSet) node needs to be a replica set member to use read concern".
 * Returns the last non-empty line, or null if nothing useful is available.
 */
export function readStartupFailure(migrationId: string): string | null {
  try {
    const text = fs.readFileSync(path.join(getLogDir(migrationId), "stdout.log"), "utf8");
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    return lines.length ? lines[lines.length - 1] : null;
  } catch {
    return null;
  }
}

export async function sendCommand(
  port: number,
  endpoint: string,
  body: Record<string, unknown> = {}
): Promise<unknown> {
  const res = await fetch(`http://localhost:${port}/api/v1/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    error?: string;
    errorDescription?: string;
  };
  if (!res.ok || json.success === false) {
    throw new Error(json.errorDescription || json.error || `mongosync ${endpoint} failed (${res.status})`);
  }
  return json;
}

export async function fetchProgress(port: number): Promise<ProgressResponse> {
  const res = await fetch(`http://localhost:${port}/api/v1/progress`);
  if (!res.ok) throw new Error(`mongosync progress failed (${res.status})`);
  return (await res.json()) as ProgressResponse;
}
