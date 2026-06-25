import { getInstances } from "./db";
import { fetchProgress, sendCommand } from "./process-manager";
import { buildStartBody } from "./config-generator";
import { aggregateInstanceProgress } from "./aggregate-progress";
import type { ProgressResponse } from "./process-manager";
import type { Migration, InstanceProgress, MongosyncState } from "./types";

/**
 * Broadcast an identical command to EVERY instance of a sharded migration. mongosync's
 * sharded sync requires the same command on every per-shard instance. Resolves once all
 * have responded; rejects if any instance returns an error (so a partial failure surfaces).
 *
 * For `start`, the body is the migration's shared /start body; other commands take `{}`.
 */
export async function broadcastCommand(
  migration: Migration,
  endpoint: "start" | "pause" | "resume" | "commit" | "reverse"
): Promise<void> {
  const instances = getInstances(migration.id);
  if (instances.length === 0) {
    throw new Error("Sharded migration has no instances to command.");
  }
  const body = endpoint === "start" ? buildStartBody(migration) : {};
  const results = await Promise.allSettled(
    instances.map((inst) => sendCommand(inst.port, endpoint, body))
  );
  const failed = results
    .map((r, i) => ({ r, inst: instances[i] }))
    .filter((x) => x.r.status === "rejected");
  if (failed.length > 0) {
    const first = failed[0].r as PromiseRejectedResult;
    const reason = first.reason instanceof Error ? first.reason.message : String(first.reason);
    throw new Error(
      `${endpoint} failed on ${failed.length} of ${instances.length} instances (shard ${failed[0].inst.shardId}): ${reason}`
    );
  }
}

/** Live per-instance progress for the detail-page per-shard breakdown. Best-effort per instance. */
export async function getInstanceProgress(migration: Migration): Promise<InstanceProgress[]> {
  const instances = getInstances(migration.id);
  return Promise.all(
    instances.map(async (inst) => {
      try {
        const resp = await fetchProgress(inst.port);
        const p = resp.progress;
        const copied = p?.collectionCopy?.estimatedCopiedBytes ?? 0;
        const total = p?.collectionCopy?.estimatedTotalBytes ?? 0;
        return {
          shardId: inst.shardId,
          port: inst.port,
          state: (p?.state as MongosyncState | undefined) ?? null,
          canCommit: !!p?.canCommit,
          copyProgress: total > 0 ? Math.min(100, Math.max(0, (copied / total) * 100)) : 0,
          estimatedCopiedBytes: copied,
          estimatedTotalBytes: total,
          lagTimeSeconds: p?.lagTimeSeconds ?? null,
          totalEventsApplied: p?.totalEventsApplied ?? 0,
          reachable: true,
        } satisfies InstanceProgress;
      } catch {
        return {
          shardId: inst.shardId,
          port: inst.port,
          state: null,
          canCommit: false,
          copyProgress: 0,
          estimatedCopiedBytes: 0,
          estimatedTotalBytes: 0,
          lagTimeSeconds: null,
          totalEventsApplied: 0,
          reachable: false,
        } satisfies InstanceProgress;
      }
    })
  );
}

/**
 * Whether EVERY instance of a sharded migration has committed (commit is blocking until all
 * instances reach COMMITTED). Reads each instance's /progress live. Returns false if any
 * instance is unreachable or not yet COMMITTED.
 */
export async function allInstancesCommitted(migration: Migration): Promise<boolean> {
  const instances = getInstances(migration.id);
  if (instances.length === 0) return false;
  const results = await Promise.all(
    instances.map(async (inst): Promise<ProgressResponse | null> => {
      try {
        return await fetchProgress(inst.port);
      } catch {
        return null;
      }
    })
  );
  return (
    results.length === instances.length &&
    results.every((r) => r?.progress?.state === "COMMITTED")
  );
}

/** Aggregate canCommit gate for a sharded migration: ALL instances reachable and canCommit. */
export async function allInstancesCanCommit(migration: Migration): Promise<boolean> {
  const instances = getInstances(migration.id);
  const results = await Promise.all(
    instances.map(async (inst): Promise<ProgressResponse | null> => {
      try {
        return await fetchProgress(inst.port);
      } catch {
        return null;
      }
    })
  );
  return aggregateInstanceProgress(results).canCommit;
}
