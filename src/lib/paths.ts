import path from "path";
import os from "os";
import fs from "fs";

export function getDataDir(): string {
  const dir = process.env.MONGOSYNC_UI_DIR || path.join(os.homedir(), ".mongosync-ui");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getConfigDir(): string {
  const dir = path.join(getDataDir(), "configs");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getLogDir(migrationId: string): string {
  const dir = path.join(getDataDir(), "logs", migrationId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Per-instance log directory for a sharded migration: `logs/<migrationId>/<shardId>`.
 * Each mongosync instance gets its own log/metrics dir so their output never collides.
 */
export function getInstanceLogDir(migrationId: string, shardId: string): string {
  const dir = path.join(getDataDir(), "logs", migrationId, safeSegment(shardId));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Sanitise a shard id for use as a filesystem path segment (shard ids are normally
// simple identifiers, but be defensive against slashes / dots that could escape the dir).
function safeSegment(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, "_");
}
