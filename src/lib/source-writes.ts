import { runMongoshJson } from "./mongosh";

/**
 * Source-write detection for the Cutover Cockpit. Before a commit, the operator must have
 * stopped all application writes to the SOURCE cluster — writing during commit risks data
 * loss (CLAUDE.md §"POST /commit"). mongosync's /progress can't tell us whether the source is
 * quiesced, so we peek at the source oplog directly: are there any user-namespace writes
 * (insert/update/delete) in the last `windowSec` seconds?
 *
 * Reads `local.oplog.rs`, which requires the connected source user to hold the `backup` /
 * `clusterMonitor` roles — exactly mongosync's recommended source role set — so a correctly
 * permissioned sync user gets this for free. Best-effort: any failure (mongosh missing,
 * unreachable, missing privilege) returns `ok: false` with `writesDetected: null` so the UI
 * shows "unknown" rather than a false all-clear.
 */
export interface SourceWriteCheck {
  /** True when the probe ran and produced a usable answer. */
  ok: boolean;
  /** Writes seen in the window; null when the probe couldn't determine it. */
  writesDetected: boolean | null;
  /** Number of user-namespace ops observed in the window (capped). */
  recentCount: number | null;
  /** Seconds since the most recent user write in the window, or null. */
  lastWriteAgoSec: number | null;
  /** The lookback window used, in seconds. */
  windowSec: number;
  /** Failure reason, when ok is false. */
  error?: string;
}

// Tail the source oplog for recent user-namespace writes. A `ts >= since` range scan on the
// capped oplog is cheap (it's naturally ordered by ts); the `limit(50)` bounds the result.
// Internal namespaces (admin/config/local and mongosync's own state DB) are excluded so the
// migration's own bookkeeping never counts as application traffic.
const SCRIPT = `
var oplog = db.getSiblingDB("local").oplog.rs;
var now = new Date();
var sinceSecs = Math.floor(now.getTime() / 1000) - WINDOW_SEC;
var recent = oplog
  .find({
    ts: { $gte: Timestamp(sinceSecs, 0) },
    op: { $in: ["i", "u", "d"] },
    ns: { $not: /^(admin|config|local|__mdb_internal_mongosync)\\./ },
  })
  .limit(50)
  .toArray();
var lastWriteMs = null;
if (recent.length) {
  var e = recent[recent.length - 1];
  if (e.wall) lastWriteMs = new Date(e.wall).getTime();
}
print(JSON.stringify({ now: now.getTime(), recentCount: recent.length, lastWriteMs: lastWriteMs }));
`;

export async function checkSourceWrites(uri: string, windowSec = 10): Promise<SourceWriteCheck> {
  const script = SCRIPT.replace(/WINDOW_SEC/g, String(windowSec));
  try {
    const parsed = await runMongoshJson<{
      now: number;
      recentCount: number;
      lastWriteMs: number | null;
    }>(uri, script, { timeoutMs: 8000 });
    const recentCount = Number.isFinite(parsed.recentCount) ? parsed.recentCount : 0;
    const lastWriteAgoSec =
      parsed.lastWriteMs != null && parsed.now >= parsed.lastWriteMs
        ? Math.round((parsed.now - parsed.lastWriteMs) / 1000)
        : null;
    return {
      ok: true,
      writesDetected: recentCount > 0,
      recentCount,
      lastWriteAgoSec,
      windowSec,
    };
  } catch (e) {
    return {
      ok: false,
      writesDetected: null,
      recentCount: null,
      lastWriteAgoSec: null,
      windowSec,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
