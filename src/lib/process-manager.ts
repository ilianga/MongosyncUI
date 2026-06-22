import { spawn } from "node:child_process";
import fs from "fs";
import path from "path";
import type { Migration } from "./types";
import { generateConfig } from "./config-generator";
import { getLogDir } from "./paths";
import { getSetting, updateMigration } from "./db";

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

function getMongosyncPath(): string {
  return getSetting("mongosyncPath") || "mongosync";
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function spawnMongosync(migration: Migration): number {
  const configPath = generateConfig(migration);
  const logDir = getLogDir(migration.id);
  const outFd = fs.openSync(path.join(logDir, "stdout.log"), "a");
  const errFd = fs.openSync(path.join(logDir, "stderr.log"), "a");
  const child = spawn(getMongosyncPath(), ["--config", configPath], {
    detached: true,
    stdio: ["ignore", outFd, errFd],
  });
  // Close parent's copies of the FDs — child already inherited them.
  fs.closeSync(outFd);
  fs.closeSync(errFd);
  if (!child.pid) throw new Error("Failed to spawn mongosync (binary not found or not executable?)");
  child.unref();
  const pid = child.pid;
  updateMigration(migration.id, { pid });
  return pid;
}

export function killMongosync(migration: Migration): void {
  if (migration.pid && isProcessAlive(migration.pid)) {
    try {
      process.kill(migration.pid, "SIGTERM");
    } catch {
      // already gone
    }
  }
  updateMigration(migration.id, { pid: null });
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
