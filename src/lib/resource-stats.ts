import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Migration } from "./types";

const execFileAsync = promisify(execFile);

export interface ProcessStats {
  /** Process CPU usage as a percentage (as reported by `ps %cpu`). */
  cpuPercent: number;
  /** Resident set size in bytes. */
  rssBytes: number;
  /** Elapsed time since the process started, in seconds. */
  uptimeSec: number;
}

/**
 * Resolve the OS PID of a migration's mongosync process. Under supervision the
 * stored `migration.pid` is informational (0), so we match the config path the
 * binary was launched with: `mongosync --config <id>.yaml`. Falls back to the
 * stored pid (legacy mode). Returns null if no live process can be found.
 */
async function resolvePid(migration: Migration): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync("pgrep", ["-f", `${migration.id}.yaml`], {
      timeout: 4000,
    });
    const pid = stdout
      .split("\n")
      .map((l) => l.trim())
      .find((l) => /^\d+$/.test(l));
    if (pid) return Number(pid);
  } catch {
    /* pgrep found nothing or is unavailable — fall back to the stored pid */
  }
  if (migration.pid != null && migration.pid > 0) return migration.pid;
  return null;
}

/**
 * OS-level resource metrics (CPU %, RSS memory, uptime) for a migration's
 * mongosync process. Best-effort: returns null on any failure (no process,
 * `ps` error, unparseable output) so callers can leave the fields unset.
 */
export async function getProcessStats(migration: Migration): Promise<ProcessStats | null> {
  const pid = await resolvePid(migration);
  if (pid == null) return null;
  try {
    const { stdout } = await execFileAsync(
      "ps",
      ["-o", "%cpu=,rss=,etimes=", "-p", String(pid)],
      { timeout: 4000 }
    );
    const line = stdout.trim();
    if (!line) return null;
    const parts = line.split(/\s+/);
    if (parts.length < 3) return null;
    const cpuPercent = Number(parts[0]);
    const rssKb = Number(parts[1]);
    const uptimeSec = Number(parts[2]);
    if (!Number.isFinite(cpuPercent) || !Number.isFinite(rssKb) || !Number.isFinite(uptimeSec)) {
      return null;
    }
    return { cpuPercent, rssBytes: rssKb * 1024, uptimeSec };
  } catch {
    return null;
  }
}
