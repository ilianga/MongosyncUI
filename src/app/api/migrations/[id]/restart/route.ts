import { NextRequest, NextResponse } from "next/server";
import { getMigration, updateMigration } from "@/lib/db";
import { spawnMongosync, sendCommand, killMongosync, readStartupFailure, type ProgressResponse } from "@/lib/process-manager";
import { buildStartBody } from "@/lib/config-generator";
import { startPoller } from "@/lib/poller";
import { readWrapperStatus } from "@/lib/supervisor";
import { computeSourceTotalBytes } from "@/lib/source-stats";
import { initApp } from "@/lib/init";
import type { StartConfig } from "@/lib/types";

// Resume a STOPPED migration: respawn the binary, wait for it to be ready, then re-issue
// /start. mongosync detects the resumable state persisted on the destination and continues
// from where it left off (same mechanism the poller uses after a crash+respawn).
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  initApp();
  const { id } = await params;
  const migration = getMigration(id);
  if (!migration) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Refresh the stable progress denominator in parallel with the startup wait.
  const cfg = JSON.parse(migration.config) as StartConfig;
  const plannedTotalPromise = computeSourceTotalBytes(migration.sourceUri, cfg).catch(() => null);

  try {
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
      return NextResponse.json({ error: detail }, { status: 500 });
    }

    const plannedTotalBytes = await plannedTotalPromise;
    await sendCommand(migration.port, "start", buildStartBody(migration));
    updateMigration(id, {
      state: "RUNNING", desiredRunning: 1, stopped: 0, supervisionStatus: "running",
      ...(plannedTotalBytes ? { plannedTotalBytes } : {}),
    });
    startPoller();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
