import { getAllMigrations, updateMigration, insertMetric } from "./db";
import { fetchProgress, sendCommand, isProcessAlive } from "./process-manager";
import type { ProgressResponse } from "./process-manager";
import { reconcile } from "./supervisor";
import { sessionName, sessionExists, killSession } from "./tmux";
import { classifyTick } from "./health-monitor";
import { getSupervisionConfig } from "./supervision-config";
import { buildStartBody } from "./config-generator";
import type { MetricInput, MongosyncState, Migration } from "./types";

let intervalId: ReturnType<typeof setInterval> | null = null;

// States where mongosync is actively reporting progress worth recording.
const ACTIVE_STATES = ["RUNNING", "COMMITTING", "REVERSING", "PAUSED"];
// States a supervised, freshly-respawned binary shows before we re-drive /start.
const RESUME_STATES = ["IDLE", "INITIALIZING"];

// Per-migration count of consecutive unreachable /progress probes (in-memory).
const unreachable = new Map<string, number>();

export function progressToMetric(migrationId: string, resp: ProgressResponse): MetricInput {
  const p = resp.progress;
  const copied = p?.collectionCopy?.estimatedCopiedBytes ?? 0;
  const total = p?.collectionCopy?.estimatedTotalBytes ?? 0;
  return {
    migrationId,
    state: p?.state ?? "RUNNING",
    copyProgress: total > 0 ? (copied / total) * 100 : 0,
    estimatedCopiedBytes: copied,
    estimatedTotalBytes: total,
    lagTimeSeconds: p?.lagTimeSeconds ?? null,
    totalEventsApplied: p?.totalEventsApplied ?? 0,
    estimatedSecondsToCEACatchup: p?.estimatedSecondsToCEACatchup ?? null,
    indexesBuilt: p?.indexBuilding?.indexesBuilt ?? 0,
    totalIndexesToBuild: p?.indexBuilding?.totalIndexesToBuild ?? 0,
    sourcePingMs: p?.source?.pingLatencyMs ?? null,
    destPingMs: p?.destination?.pingLatencyMs ?? null,
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
    insertMetric(progressToMetric(m.id, resp));
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

export async function pollOnce(): Promise<void> {
  // Drive desired-vs-actual first so crashed/missing sessions are rebuilt before probing.
  reconcile();
  const cfg = getSupervisionConfig();
  for (const m of getAllMigrations()) {
    if (!m.desiredRunning && !ACTIVE_STATES.includes(m.state)) continue;

    // Legacy / unsupervised migration: if the PID we stored is no longer alive, clear it
    // and skip probing — there is no process to query and no supervisor to restart it.
    if (!m.desiredRunning && m.pid !== null && m.pid !== undefined && !isProcessAlive(m.pid)) {
      updateMigration(m.id, { pid: null });
      continue;
    }

    await probe(m, cfg.hungTicks);
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
