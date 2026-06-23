import { deriveRate } from "./format";
import type { Metric, MongosyncState } from "./types";

/**
 * Phase-aware migration progress + ETA. PURE module: never reads Date.now() or `new Date()`
 * — all timing is derived from the metrics' own `timestamp` fields — so it is fully
 * unit-testable and produces identical output on server (card enrichment) and client
 * (detail-page pipeline panel).
 */

export type Phase =
  | "copy"
  | "index"
  | "cea"
  | "ready"
  | "committing"
  | "committed"
  | "reversing"
  | "idle";

export interface PipelineStep {
  phase: Phase;
  label: string;
  state: "done" | "active" | "pending";
}

export interface MigrationProgress {
  phase: Phase;
  phaseLabel: string;
  /** 0-100 for the current phase, or null when it can't be determined. */
  phaseProgressPct: number | null;
  /** Seconds remaining in the current phase, or null when unknowable. */
  etaSec: number | null;
  /** Short human-readable substate, e.g. "lag 8s" or "3 / 12 indexes". */
  detail: string;
  /** The four headline phases as a left-to-right pipeline (copy → index → cea → ready). */
  pipeline: PipelineStep[];
}

/** Compact subset attached to each migration by GET /api/migrations for the card glimpse. */
export interface ProgressGlimpse {
  phase: Phase;
  phaseLabel: string;
  phaseProgressPct: number | null;
  etaSec: number | null;
  detail: string;
}

const PHASE_LABELS: Record<Phase, string> = {
  copy: "Copying",
  index: "Building indexes",
  cea: "Catching up",
  ready: "Ready to commit",
  committing: "Committing",
  committed: "Committed",
  reversing: "Reversing",
  idle: "Idle",
};

// The four headline phases shown as a pipeline, in order.
const PIPELINE_PHASES: { phase: Phase; label: string }[] = [
  { phase: "copy", label: "Copy" },
  { phase: "index", label: "Index build" },
  { phase: "cea", label: "Catch-up" },
  { phase: "ready", label: "Ready" },
];

// Rank of each headline phase, so the pipeline can mark earlier phases "done".
const PIPELINE_RANK: Partial<Record<Phase, number>> = {
  copy: 0,
  index: 1,
  cea: 2,
  ready: 3,
};

export interface ComputeProgressOpts {
  /** Stable copy denominator computed at start; preferred over mongosync's estimate. */
  plannedTotalBytes?: number | null;
  /** How many trailing samples to average copy throughput over (default 6). */
  rateWindow?: number;
}

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

/**
 * Build the pipeline track. A phase is "active" if it's the current headline phase;
 * "done" if it ranks before the current phase (or the migration is past the pipeline,
 * e.g. committing/committed); "pending" otherwise.
 */
function buildPipeline(phase: Phase): PipelineStep[] {
  // committing/committed/reversing live past "ready" — treat the whole track as done.
  const pastPipeline = phase === "committing" || phase === "committed" || phase === "reversing";
  const activeRank = PIPELINE_RANK[phase];
  return PIPELINE_PHASES.map(({ phase: p, label }) => {
    const rank = PIPELINE_RANK[p]!;
    let state: PipelineStep["state"];
    if (pastPipeline) {
      state = "done";
    } else if (activeRank == null) {
      state = "pending"; // idle — nothing started
    } else if (rank < activeRank) {
      state = "done";
    } else if (rank === activeRank) {
      state = "active";
    } else {
      state = "pending";
    }
    return { phase: p, label, state };
  });
}

/**
 * Copy ETA = remaining bytes ÷ rolling-average throughput (bytes/sec), where throughput is
 * `deriveRate` over the last N `estimatedCopiedBytes` samples. Returns null when there are
 * too few samples or the averaged rate is ≈0 (stalled/unknown — be honest rather than show
 * an absurd ETA).
 */
function computeCopyEta(
  metrics: Metric[],
  copiedNow: number,
  denominator: number,
  rateWindow: number
): number | null {
  if (denominator <= 0 || copiedNow >= denominator) return null;
  const tail = metrics.slice(-rateWindow);
  const samples = tail.map((m) => ({ timestamp: m.timestamp, value: m.estimatedCopiedBytes }));
  const rates = deriveRate(samples);
  if (rates.length === 0) return null;
  const avgRate = rates.reduce((sum, r) => sum + r.value, 0) / rates.length;
  if (avgRate <= 1) return null; // ≈0 bytes/sec — stalled or insufficient signal
  const remaining = denominator - copiedNow;
  const eta = remaining / avgRate;
  return Number.isFinite(eta) && eta >= 0 ? eta : null;
}

/**
 * Catch-up (CEA) phase progress, derived purely from the lag trend across the supplied
 * metrics: 100·(1 − lag/maxLagSeen), clamped to 0-100. When lag has fallen from its peak
 * toward 0 the bar fills; null when we've never seen a positive lag.
 */
function computeCeaPct(metrics: Metric[], lagNow: number): number | null {
  let maxLag = 0;
  for (const m of metrics) {
    if (m.lagTimeSeconds != null && m.lagTimeSeconds > maxLag) maxLag = m.lagTimeSeconds;
  }
  if (maxLag <= 0) return null;
  return clampPct(100 * (1 - lagNow / maxLag));
}

/**
 * Determine the current phase and per-phase progress + ETA from the polled metric series
 * and the migration's mongosync state. The latest metric drives the snapshot; the trailing
 * window drives copy-throughput and lag-trend derivations.
 */
export function computeMigrationProgress(
  metrics: Metric[],
  state: MongosyncState | string,
  opts: ComputeProgressOpts = {}
): MigrationProgress {
  const rateWindow = opts.rateWindow ?? 6;
  const latest = metrics.length ? metrics[metrics.length - 1] : undefined;

  const make = (
    phase: Phase,
    phaseProgressPct: number | null,
    etaSec: number | null,
    detail: string
  ): MigrationProgress => ({
    phase,
    phaseLabel: PHASE_LABELS[phase],
    phaseProgressPct,
    etaSec,
    detail,
    pipeline: buildPipeline(phase),
  });

  // Terminal / cutover states are driven by mongosync state, not metrics.
  if (state === "COMMITTING") return make("committing", null, null, "Cutover in progress");
  if (state === "COMMITTED") return make("committed", 100, null, "Cutover complete");
  if (state === "REVERSING") return make("reversing", null, null, "Reversing direction");

  // No data yet (or never started) → idle.
  if (!latest) return make("idle", null, null, "No progress data yet");

  const canCommit = latest.canCommit === 1;
  const copyPct = clampPct(latest.copyProgress);
  const indexesBuilt = latest.indexesBuilt;
  const totalIndexes = latest.totalIndexesToBuild;
  const lag = latest.lagTimeSeconds ?? 0;
  const indexesBuilding = totalIndexes > indexesBuilt;

  // canCommit wins once true — mongosync says cutover will succeed now.
  if (canCommit) {
    return make("ready", 100, null, "Lag is low — safe to commit");
  }

  // Still copying.
  if (copyPct < 100) {
    const denominator = opts.plannedTotalBytes || latest.estimatedTotalBytes;
    const eta = computeCopyEta(metrics, latest.estimatedCopiedBytes, denominator, rateWindow);
    return make("copy", copyPct, eta, `${copyPct.toFixed(0)}% copied`);
  }

  // Copy done, indexes still building → honest "in progress" (no ETA: mongosync only
  // counts COMPLETED builds, so an estimate would be misleading).
  if (indexesBuilding) {
    const pct = totalIndexes > 0 ? clampPct((indexesBuilt / totalIndexes) * 100) : null;
    return make("index", pct, null, `${indexesBuilt} / ${totalIndexes} indexes`);
  }

  // Copy done, change events still catching up.
  if (lag > 0) {
    const pct = computeCeaPct(metrics, lag);
    return make("cea", pct, latest.estimatedSecondsToCEACatchup, `lag ${Math.round(lag)}s`);
  }

  // Copy done, no index work pending, lag at/near zero but mongosync hasn't yet flipped
  // canCommit — treat as catch-up nearly complete.
  return make("cea", 100, latest.estimatedSecondsToCEACatchup, "Catching up");
}

/** Project the full result down to the compact glimpse the card enrichment attaches. */
export function toProgressGlimpse(p: MigrationProgress): ProgressGlimpse {
  return {
    phase: p.phase,
    phaseLabel: p.phaseLabel,
    phaseProgressPct: p.phaseProgressPct,
    etaSec: p.etaSec,
    detail: p.detail,
  };
}
