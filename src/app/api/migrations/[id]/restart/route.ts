import { getMigration, getInstances, updateMigration } from "@/lib/db";
import { spawnMongosync, sendCommand, killMongosync, spawnShardedInstances, killShardedInstances, readStartupFailure, type ProgressResponse } from "@/lib/process-manager";
import { buildStartBody } from "@/lib/config-generator";
import { broadcastCommand } from "@/lib/sharded-lifecycle";
import { startPoller } from "@/lib/poller";
import { readWrapperStatus, readInstanceWrapperStatus } from "@/lib/supervisor";
import { computeSourceTotalBytes } from "@/lib/source-stats";
import { initApp } from "@/lib/init";
import type { StartConfig } from "@/lib/types";
import { handle, jsonOk, jsonError, ApiError } from "@/lib/api";

type Ctx = { params: Promise<{ id: string }> };

// Resume a STOPPED migration: respawn the binary, wait for it to be ready, then re-issue
// /start. mongosync detects the resumable state persisted on the destination and continues
// from where it left off (same mechanism the poller uses after a crash+respawn).
export const POST = handle(async (_req: Request, { params }: Ctx) => {
  initApp();
  const { id } = await params;
  const migration = getMigration(id);
  if (!migration) throw new ApiError("Not found", 404);

  // Refresh the stable progress denominator in parallel with the startup wait.
  const cfg = JSON.parse(migration.config) as StartConfig;
  const plannedTotalPromise = computeSourceTotalBytes(migration.sourceUri, cfg).catch(() => null);

  // Sharded migrations restart all instances and re-broadcast /start.
  if (migration.sharded) {
    const instances = getInstances(id);
    spawnShardedInstances(migration);

    const pending = new Set(instances.map((i) => i.shardId));
    let crashed = false;
    for (let i = 0; i < 60 && pending.size > 0; i++) {
      for (const shardId of pending) {
        if (readInstanceWrapperStatus(id, shardId)?.state === "crash_looping") { crashed = true; break; }
      }
      if (crashed) break;
      await Promise.all(
        instances
          .filter((inst) => pending.has(inst.shardId))
          .map(async (inst) => {
            try {
              const res = await fetch(`http://localhost:${inst.port}/api/v1/progress`);
              if (res.ok) {
                const body = (await res.json().catch(() => ({}))) as ProgressResponse;
                const s = body.progress?.state;
                if (s && s !== "INITIALIZING") pending.delete(inst.shardId);
              }
            } catch { /* not ready yet */ }
          })
      );
      if (pending.size > 0) await new Promise((r) => setTimeout(r, 500));
    }

    if (pending.size > 0) {
      killShardedInstances(getMigration(id) ?? migration);
      const detail = crashed
        ? "a mongosync instance crash-looped on restart (see logs)"
        : `${pending.size} of ${instances.length} mongosync instances did not become ready within 30s`;
      return jsonError(detail, 500);
    }

    const plannedTotalBytesSharded = await plannedTotalPromise;
    await broadcastCommand(migration, "start");
    updateMigration(id, {
      state: "RUNNING", desiredRunning: 1, stopped: 0, supervisionStatus: "running",
      ...(plannedTotalBytesSharded ? { plannedTotalBytes: plannedTotalBytesSharded } : {}),
    });
    startPoller();
    return jsonOk({ ok: true });
  }

  spawnMongosync(migration);

  let ready = false;
  let crashed = false;
  for (let i = 0; i < 60; i++) {
    if (readWrapperStatus(migration.id)?.state === "crash_looping") { crashed = true; break; }
    try {
      const res = await fetch(`http://localhost:${migration.port}/api/v1/progress`);
      if (res.ok) {
        const body = (await res.json().catch(() => ({}))) as ProgressResponse;
        // A resumed binary may come up IDLE (fresh) or already RUNNING/PAUSED if it
        // re-attached to persisted state — any non-INITIALIZING state means /start is safe.
        const s = body.progress?.state;
        if (s && s !== "INITIALIZING") { ready = true; break; }
      }
    } catch { /* not ready yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }

  if (!ready) {
    const reason = readStartupFailure(migration.id);
    killMongosync(getMigration(migration.id) ?? migration);
    const detail = reason
      ? `mongosync failed to restart: ${reason}`
      : crashed
        ? "mongosync crash-looped on restart (see logs)"
        : "mongosync did not become ready within 30s";
    return jsonError(detail, 500);
  }

  const plannedTotalBytes = await plannedTotalPromise;
  await sendCommand(migration.port, "start", buildStartBody(migration));
  updateMigration(id, {
    state: "RUNNING", desiredRunning: 1, stopped: 0, supervisionStatus: "running",
    ...(plannedTotalBytes ? { plannedTotalBytes } : {}),
  });
  startPoller();
  return jsonOk({ ok: true });
});
