import { getAllMigrations, updateMigration, insertMetric } from "./db";
import { fetchProgress, isProcessAlive } from "./process-manager";
import type { ProgressResponse } from "./process-manager";
import type { MetricInput, MongosyncState } from "./types";

let intervalId: ReturnType<typeof setInterval> | null = null;

// States where mongosync is actively reporting progress worth recording.
const ACTIVE_STATES = ["RUNNING", "COMMITTING", "REVERSING", "PAUSED"];

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

export async function pollOnce(): Promise<void> {
  for (const m of getAllMigrations()) {
    // Reconcile a dead process.
    if (m.pid && !isProcessAlive(m.pid)) {
      updateMigration(m.id, { pid: null });
      continue;
    }
    if (!m.pid || !ACTIVE_STATES.includes(m.state)) continue;

    try {
      const resp = await fetchProgress(m.port);
      const liveState = resp.progress?.state as MongosyncState | undefined;
      if (liveState && liveState !== m.state) updateMigration(m.id, { state: liveState });
      insertMetric(progressToMetric(m.id, resp));
    } catch {
      // process may still be initializing — ignore this tick
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
