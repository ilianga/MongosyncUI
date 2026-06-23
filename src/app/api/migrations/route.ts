import { NextRequest, NextResponse } from "next/server";
import { getAllMigrations, createMigration, getMigration, updateMigration, deleteMigration, getSetting, getLatestMetric } from "@/lib/db";
import { spawnMongosync, sendCommand, killMongosync, readStartupFailure, type ProgressResponse } from "@/lib/process-manager";
import { buildStartBody } from "@/lib/config-generator";
import { startPoller } from "@/lib/poller";
import { readWrapperStatus } from "@/lib/supervisor";
import { initApp } from "@/lib/init";
import { hasSyncState } from "@/lib/cluster-check";
import { computeSourceTotalBytes } from "@/lib/source-stats";

export async function GET() {
  initApp();
  // Attach the latest polled snapshot so the dashboard card can show a real progress bar,
  // lag, and canCommit at a glance without each card fetching live /progress itself.
  const migrations = getAllMigrations().map((m) => {
    const latest = getLatestMetric(m.id);
    return {
      ...m,
      copyProgress: latest?.copyProgress ?? null,
      live: latest
        ? {
            copyProgress: latest.copyProgress,
            canCommit: latest.canCommit === 1,
            lagTimeSeconds: latest.lagTimeSeconds,
            totalEventsApplied: latest.totalEventsApplied,
            estimatedSecondsToCEACatchup: latest.estimatedSecondsToCEACatchup,
            estimatedCopiedBytes: latest.estimatedCopiedBytes,
            estimatedTotalBytes: latest.estimatedTotalBytes,
            sourcePingMs: latest.sourcePingMs,
            destPingMs: latest.destPingMs,
            cpuPercent: latest.cpuPercent,
            rssBytes: latest.rssBytes,
            uptimeSec: latest.uptimeSec,
            updatedAt: latest.timestamp,
          }
        : null,
    };
  });
  return NextResponse.json(migrations);
}

export async function POST(request: NextRequest) {
  initApp();
  const { name, sourceUri, destUri, config } = await request.json();

  const basePort = Number(getSetting("basePort") || "27182");
  const used = new Set(getAllMigrations().map((m) => m.port));
  let port = basePort;
  while (used.has(port)) port++;

  // Apply settings-level defaults only where the form left a field unset.
  const merged = {
    verbosity: getSetting("defaultVerbosity") || undefined,
    loadLevel: getSetting("defaultLoadLevel") ? Number(getSetting("defaultLoadLevel")) : undefined,
    disableTelemetry: getSetting("defaultDisableTelemetry") === "true" || undefined,
    verificationEnabled:
      getSetting("defaultVerification") != null ? getSetting("defaultVerification") === "true" : undefined,
    ...(config ?? {}),
  };

  const migration = createMigration({ name, sourceUri, destUri, config: merged, port });

  // Compute the stable copy-progress denominator from the source in parallel with the
  // (~30s) startup wait, so it costs no extra latency. Best-effort: null on failure.
  const plannedTotalPromise = computeSourceTotalBytes(sourceUri, merged).catch(() => null);

  try {
    spawnMongosync(migration);

    // Wait for mongosync to be ready for /start. The HTTP API answers /progress
    // while still INITIALIZING (connecting to both clusters), so reachability is
    // not enough — /start is only accepted once the binary reaches IDLE. Poll the
    // reported state, not just res.ok, or /start races ahead of initialization
    // and fails with "mongosync is still initializing and is not ready to start".
    let ready = false;
    let crashed = false;
    for (let i = 0; i < 60; i++) {
      // Bail early if the supervisor has given up — no point waiting out the timeout.
      if (readWrapperStatus(migration.id)?.state === "crash_looping") { crashed = true; break; }
      try {
        const res = await fetch(`http://localhost:${port}/api/v1/progress`);
        if (res.ok) {
          const body = (await res.json().catch(() => ({}))) as ProgressResponse;
          if (body.progress?.state === "IDLE") { ready = true; break; }
        }
      } catch { /* not ready */ }
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!ready) {
      // Capture the real failure reason from the log before tearing down the migration.
      const reason = readStartupFailure(migration.id);
      const latest = getMigration(migration.id);
      if (latest) killMongosync(latest);
      deleteMigration(migration.id);

      // A common cause of "never reaches IDLE" is leftover sync state on the destination
      // from a prior aborted run: mongosync auto-resumes it instead of starting fresh.
      // Surface a distinct code so the UI can offer to drop it and retry, rather than
      // showing a generic timeout. Detection is best-effort (needs mongosh).
      if (!reason && !crashed) {
        try {
          if (await hasSyncState(destUri)) {
            return NextResponse.json(
              {
                error:
                  "The destination already has mongosync sync state (__mdb_internal_mongosync) from a previous run.",
                code: "DEST_HAS_SYNC_STATE",
              },
              { status: 409 }
            );
          }
        } catch { /* mongosh unavailable — fall through to the generic error */ }
      }

      const detail = reason
        ? `mongosync failed to start: ${reason}`
        : crashed
          ? "mongosync crash-looped on startup (see logs)"
          : "mongosync did not reach IDLE within 30s";
      return NextResponse.json({ error: detail }, { status: 500 });
    }

    const plannedTotalBytes = await plannedTotalPromise;
    await sendCommand(port, "start", buildStartBody(migration));
    updateMigration(migration.id, { state: "RUNNING", ...(plannedTotalBytes ? { plannedTotalBytes } : {}) });
    startPoller();
    return NextResponse.json(getMigration(migration.id), { status: 201 });
  } catch (error) {
    const latest = getMigration(migration.id);
    if (latest) killMongosync(latest);
    deleteMigration(migration.id);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
