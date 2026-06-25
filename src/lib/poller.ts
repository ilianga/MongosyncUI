import { getAllMigrations, getInstances, updateMigration, insertMetric } from "./db";
import { fetchProgress, sendCommand, isProcessAlive } from "./process-manager";
import type { ProgressResponse } from "./process-manager";
import { reconcile } from "./supervisor";
import { sessionName, instanceSessionName, sessionExists, killSession } from "./tmux";
import { classifyTick } from "./health-monitor";
import { getSupervisionConfig } from "./supervision-config";
import { buildStartBody } from "./config-generator";
import { getProcessStats } from "./resource-stats";
import { aggregateInstanceProgress } from "./aggregate-progress";
import type { MetricInput, MongosyncState, Migration } from "./types";

let intervalId: ReturnType<typeof setInterval> | null = null;

// States where mongosync is actively reporting progress worth recording.
const ACTIVE_STATES = ["RUNNING", "COMMITTING", "REVERSING", "PAUSED"];
// States a supervised, freshly-respawned binary shows before we re-drive /start.
const RESUME_STATES = ["IDLE", "INITIALIZING"];

// Per-migration count of consecutive unreachable /progress probes (in-memory).
const unreachable = new Map<string, number>();

export function progressToMetric(
  migrationId: string,
  resp: ProgressResponse,
  plannedTotalBytes?: number | null
): MetricInput {
  const p = resp.progress;
  const copied = p?.collectionCopy?.estimatedCopiedBytes ?? 0;
  const mongoTotal = p?.collectionCopy?.estimatedTotalBytes ?? 0;
  // Prefer our stable source-computed total; mongosync's estimate is unreliable early
  // (starts low, jumps as it discovers data), which makes progress spike then drop.
  const denom = plannedTotalBytes && plannedTotalBytes > 0 ? plannedTotalBytes : mongoTotal;
  const copyProgress = denom > 0 ? Math.min(100, Math.max(0, (copied / denom) * 100)) : 0;
  return {
    migrationId,
    state: p?.state ?? "RUNNING",
    copyProgress,
    canCommit: p?.canCommit ? 1 : 0,
    estimatedCopiedBytes: copied,
    estimatedTotalBytes: mongoTotal,
    lagTimeSeconds: p?.lagTimeSeconds ?? null,
    totalEventsApplied: p?.totalEventsApplied ?? 0,
    estimatedSecondsToCEACatchup: p?.estimatedSecondsToCEACatchup ?? null,
    indexesBuilt: p?.indexBuilding?.indexesBuilt ?? 0,
    totalIndexesToBuild: p?.indexBuilding?.totalIndexesToBuild ?? 0,
    sourcePingMs: p?.source?.pingLatencyMs ?? null,
    destPingMs: p?.destination?.pingLatencyMs ?? null,
    // OS-level process metrics are merged in by probe() from getProcessStats();
    // default to null here so a plain progressToMetric result stays a valid MetricInput.
    cpuPercent: null,
    rssBytes: null,
    uptimeSec: null,
  };
}

async function probe(m: Migration, hungTicks: number): Promise<void> {
  try {
    const resp = await fetchProgress(m.port);
    unreachable.set(m.id, 0);
    const liveState = resp.progress?.state as MongosyncState | undefined;

    // Resume: a respawned mongosync binary comes up IDLE (or INITIALIZING) with no
    // in-memory state. Re-issuing /start with the same parameters causes mongosync to
    // detect the existing progress persisted on the destination cluster and resume from
    // where it left off. Source: CLAUDE.md §"POST /resume" — "Resumes from PAUSED using
    // state stored on the destination." The same destination-persisted state is consulted
    // by /start on a freshly-started binary, so the behaviour extends to full restarts.
    //
    // Guard: only re-drive /start when the DB state is RUNNING. A PAUSED migration
    // (desiredRunning=1 but the user deliberately paused it) or a COMMITTED migration
    // (post-cutover, kept supervised so /reverse still works) must NOT be auto-resumed
    // after a crash+respawn — their DB state correctly reflects that intent.
    if (m.desiredRunning && m.state === "RUNNING" && liveState && RESUME_STATES.includes(liveState)) {
      try { await sendCommand(m.port, "start", buildStartBody(m)); } catch { /* next tick retries */ }
      return;
    }

    if (liveState && liveState !== m.state) updateMigration(m.id, { state: liveState });
    // Best-effort OS-level resource metrics; null result leaves the fields unset.
    const stats = await getProcessStats(m);
    insertMetric({ ...progressToMetric(m.id, resp, m.plannedTotalBytes), ...(stats ?? {}) });
  } catch {
    if (!m.desiredRunning) return; // not supervised → nothing to rescue
    const name = sessionName(m.id);
    if (!sessionExists(name)) return; // gone entirely → reconcile() will recreate it
    const { consecutive, action } = classifyTick(unreachable.get(m.id) ?? 0, "unreachable", hungTicks);
    unreachable.set(m.id, consecutive);
    if (action === "restart") {
      // Kill the pane; reconcile() (next tick / same run) recreates the session.
      killSession(name);
      unreachable.set(m.id, 0);
      updateMigration(m.id, { supervisionStatus: "restarting", lastRestartAt: Date.now() });
    }
  }
}

// Probe and aggregate all instances of a SHARDED migration. Each instance is probed on its
// own port; a respawned instance (IDLE/INITIALIZING while the migration should be RUNNING)
// gets /start re-driven; an instance that is unreachable for hungTicks ticks is restarted
// (kill its session → reconcile recreates it). The N results are aggregated into ONE metric
// for the migration. The single-instance probe() above is untouched.
async function probeSharded(m: Migration, hungTicks: number): Promise<void> {
  const instances = getInstances(m.id);
  if (instances.length === 0) return;

  const results: (ProgressResponse | null)[] = await Promise.all(
    instances.map(async (inst) => {
      const key = `${m.id}:${inst.shardId}`;
      try {
        const resp = await fetchProgress(inst.port);
        unreachable.set(key, 0);
        const liveState = resp.progress?.state as MongosyncState | undefined;
        // Re-drive /start on a freshly-respawned instance, same logic as single-instance.
        if (
          m.desiredRunning &&
          m.state === "RUNNING" &&
          liveState &&
          RESUME_STATES.includes(liveState)
        ) {
          try {
            await sendCommand(inst.port, "start", buildStartBody(m));
          } catch {
            /* next tick retries */
          }
        }
        return resp;
      } catch {
        // Unreachable: count toward hung-restart only while the migration is supervised.
        if (m.desiredRunning) {
          const name = instanceSessionName(m.id, inst.shardId);
          if (sessionExists(name)) {
            const { consecutive, action } = classifyTick(
              unreachable.get(key) ?? 0,
              "unreachable",
              hungTicks
            );
            unreachable.set(key, consecutive);
            if (action === "restart") {
              killSession(name);
              unreachable.set(key, 0);
            }
          }
        }
        return null;
      }
    })
  );

  // Aggregate the per-instance progress into a single migration-level metric.
  const agg = aggregateInstanceProgress(results, m.plannedTotalBytes);
  if (agg.state !== m.state) updateMigration(m.id, { state: agg.state });

  // Sum OS-level resource stats across all instances (each instance is a separate process).
  const stats = await aggregateInstanceStats(m);

  const metric: MetricInput = {
    migrationId: m.id,
    state: agg.state,
    copyProgress: agg.copyProgress,
    canCommit: agg.canCommit ? 1 : 0,
    estimatedCopiedBytes: agg.estimatedCopiedBytes,
    estimatedTotalBytes: agg.estimatedTotalBytes,
    lagTimeSeconds: agg.lagTimeSeconds,
    totalEventsApplied: agg.totalEventsApplied,
    estimatedSecondsToCEACatchup: agg.estimatedSecondsToCEACatchup,
    indexesBuilt: 0,
    totalIndexesToBuild: 0,
    sourcePingMs: agg.sourcePingMs,
    destPingMs: agg.destPingMs,
    cpuPercent: stats.cpuPercent,
    rssBytes: stats.rssBytes,
    uptimeSec: stats.uptimeSec,
  };
  // Only persist a metric once at least one instance has reported, so we don't write a row
  // of zeros while every instance is still initializing.
  if (agg.reachableCount > 0) insertMetric(metric);
}

// Sum CPU/RSS and take the MAX uptime across a sharded migration's instance processes.
// Best-effort: returns nulls when nothing could be read. Reuses getProcessStats by faking a
// per-instance Migration whose config-path marker pgrep matches (`<migrationId>-<shardId>.yaml`).
async function aggregateInstanceStats(
  m: Migration
): Promise<{ cpuPercent: number | null; rssBytes: number | null; uptimeSec: number | null }> {
  try {
    const instances = getInstances(m.id);
    const each = await Promise.all(
      instances.map((inst) => {
        const safe = inst.shardId.replace(/[^a-zA-Z0-9._-]/g, "_");
        // getProcessStats matches the config-file marker `${id}.yaml`; the instance config
        // is `${migrationId}-${shardId}.yaml`, so pass that compound id.
        return getProcessStats({ ...m, id: `${m.id}-${safe}`, pid: null });
      })
    );
    const got = each.filter((s): s is NonNullable<typeof s> => s !== null);
    if (got.length === 0) return { cpuPercent: null, rssBytes: null, uptimeSec: null };
    return {
      cpuPercent: got.reduce((sum, s) => sum + s.cpuPercent, 0),
      rssBytes: got.reduce((sum, s) => sum + s.rssBytes, 0),
      uptimeSec: Math.max(...got.map((s) => s.uptimeSec)),
    };
  } catch {
    return { cpuPercent: null, rssBytes: null, uptimeSec: null };
  }
}

export async function pollOnce(): Promise<void> {
  // This runs on a setInterval; a throw here would be an unhandled rejection that kills
  // future ticks. Every step is therefore guarded so one bad migration (or a transient
  // DB/reconcile error) can never take down the whole health monitor.
  try {
    // Drive desired-vs-actual first so crashed/missing sessions are rebuilt before probing.
    reconcile();
  } catch {
    /* reconcile is best-effort; next tick retries */
  }

  let cfg;
  let migrations;
  try {
    cfg = getSupervisionConfig();
    migrations = getAllMigrations();
  } catch {
    return; // DB unavailable this tick — bail; next tick retries.
  }

  for (const m of migrations) {
    try {
      if (!m.desiredRunning && !ACTIVE_STATES.includes(m.state)) continue;

      // Sharded migration: probe + aggregate all instances on a separate branch.
      if (m.sharded) {
        await probeSharded(m, cfg.hungTicks);
        continue;
      }

      // Legacy / unsupervised migration: if the PID we stored is no longer alive, clear it
      // and skip probing — there is no process to query and no supervisor to restart it.
      if (!m.desiredRunning && m.pid !== null && m.pid !== undefined && !isProcessAlive(m.pid)) {
        updateMigration(m.id, { pid: null });
        continue;
      }

      await probe(m, cfg.hungTicks);
    } catch {
      // Per-migration isolation: a failure probing one migration must not abort the loop.
    }
  }
}

export function startPoller(intervalMs = 5000): void {
  if (intervalId) return;
  intervalId = setInterval(pollOnce, intervalMs);
  void pollOnce();
}

export function stopPoller(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
