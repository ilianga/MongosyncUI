import type { ProgressResponse } from "./process-manager";
import type { MongosyncState } from "./types";

// Aggregation of N per-instance mongosync /progress results into a single migration-level
// view. Pure: no I/O. Semantics (from the spec):
//   - copy bytes  = SUM across instances (copied and total)
//   - lag         = MAX across instances (the slowest shard governs cutover readiness)
//   - events      = SUM across instances
//   - canCommit   = ALL instances canCommit (and at least one instance present)
//   - state       = rollup (see rollupState below)
//   - pings       = MAX across instances (worst-case latency)
//   - copyProgress= derived from aggregate bytes (or planned total when provided)

export interface AggregateProgress {
  state: MongosyncState;
  canCommit: boolean;
  copyProgress: number; // 0-100
  estimatedCopiedBytes: number;
  estimatedTotalBytes: number;
  lagTimeSeconds: number | null;
  totalEventsApplied: number;
  estimatedSecondsToCEACatchup: number | null;
  sourcePingMs: number | null;
  destPingMs: number | null;
  /** Number of instances whose /progress was successfully read. */
  reachableCount: number;
  /** Total number of instances expected. */
  instanceCount: number;
}

// Priority order for the state rollup. A migration is only in a "later" state once ALL
// instances reach it; if instances disagree we report the EARLIEST (lowest-priority) state
// so the UI never claims progress an instance hasn't actually made. INITIALIZING is treated
// as the earliest (a single still-initializing instance holds the whole migration back).
const STATE_PRIORITY: Record<string, number> = {
  INITIALIZING: 0,
  IDLE: 1,
  RUNNING: 2,
  PAUSED: 3,
  COMMITTING: 4,
  COMMITTED: 5,
  REVERSING: 6,
};

/**
 * Roll up per-instance states into one. Rules:
 *  - If every instance reports the SAME state, that's the aggregate.
 *  - COMMITTED only when ALL are COMMITTED; otherwise if any is still COMMITTING the
 *    aggregate is COMMITTING (commit is blocking until every instance commits).
 *  - Otherwise report the earliest (minimum priority) state present, so a lagging instance
 *    is never hidden behind faster ones.
 *  - Unknown/empty → INITIALIZING.
 */
export function rollupState(states: (string | null | undefined)[]): MongosyncState {
  const known = states.filter((s): s is string => !!s && s in STATE_PRIORITY);
  if (known.length === 0) return "INITIALIZING";
  if (known.every((s) => s === known[0])) return known[0] as MongosyncState;
  // Commit is blocking: any instance still committing keeps the aggregate at COMMITTING,
  // even if some have already reached COMMITTED.
  if (known.includes("COMMITTING") && known.every((s) => s === "COMMITTING" || s === "COMMITTED")) {
    return "COMMITTING";
  }
  // Otherwise the earliest state wins.
  let min = known[0];
  for (const s of known) if (STATE_PRIORITY[s] < STATE_PRIORITY[min]) min = s;
  return min as MongosyncState;
}

function maxOrNull(values: (number | null | undefined)[]): number | null {
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return nums.length ? Math.max(...nums) : null;
}

/**
 * Aggregate N instance /progress results (some may be null when unreachable) into one
 * migration-level snapshot. `plannedTotalBytes`, when given and positive, is the stable
 * copy-progress denominator (sum of in-scope source data); otherwise the summed mongosync
 * estimate is used.
 */
export function aggregateInstanceProgress(
  results: (ProgressResponse | null)[],
  plannedTotalBytes?: number | null
): AggregateProgress {
  const instanceCount = results.length;
  const reached = results.filter((r): r is ProgressResponse => !!r?.progress);
  const reachableCount = reached.length;
  const progs = reached.map((r) => r.progress!);

  const estimatedCopiedBytes = progs.reduce(
    (sum, p) => sum + (p.collectionCopy?.estimatedCopiedBytes ?? 0),
    0
  );
  const estimatedTotalBytes = progs.reduce(
    (sum, p) => sum + (p.collectionCopy?.estimatedTotalBytes ?? 0),
    0
  );
  const totalEventsApplied = progs.reduce((sum, p) => sum + (p.totalEventsApplied ?? 0), 0);

  const denom = plannedTotalBytes && plannedTotalBytes > 0 ? plannedTotalBytes : estimatedTotalBytes;
  const copyProgress = denom > 0 ? Math.min(100, Math.max(0, (estimatedCopiedBytes / denom) * 100)) : 0;

  // canCommit only when every EXPECTED instance is reachable AND reports canCommit. An
  // unreachable instance means we can't confirm it's ready, so the migration cannot commit.
  const canCommit =
    instanceCount > 0 &&
    reachableCount === instanceCount &&
    progs.every((p) => p.canCommit === true);

  const lagTimeSeconds = maxOrNull(progs.map((p) => p.lagTimeSeconds ?? null));
  const estimatedSecondsToCEACatchup = maxOrNull(
    progs.map((p) => p.estimatedSecondsToCEACatchup ?? null)
  );
  const sourcePingMs = maxOrNull(progs.map((p) => p.source?.pingLatencyMs ?? null));
  const destPingMs = maxOrNull(progs.map((p) => p.destination?.pingLatencyMs ?? null));

  return {
    state: rollupState(progs.map((p) => p.state)),
    canCommit,
    copyProgress,
    estimatedCopiedBytes,
    estimatedTotalBytes,
    lagTimeSeconds,
    totalEventsApplied,
    estimatedSecondsToCEACatchup,
    sourcePingMs,
    destPingMs,
    reachableCount,
    instanceCount,
  };
}
