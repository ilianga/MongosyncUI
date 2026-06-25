import { getAllMigrations, createMigration, getMigration, updateMigration, deleteMigration, getSetting, getLatestMetric, getRecentMetrics, createInstances } from "@/lib/db";
import { computeMigrationProgress, toProgressGlimpse } from "@/lib/progress";
import { spawnMongosync, sendCommand, killMongosync, spawnShardedInstances, killShardedInstances, readStartupFailure, type ProgressResponse } from "@/lib/process-manager";
import { buildStartBody } from "@/lib/config-generator";
import { startPoller } from "@/lib/poller";
import { readWrapperStatus, readInstanceWrapperStatus } from "@/lib/supervisor";
import { broadcastCommand } from "@/lib/sharded-lifecycle";
import { listSourceShards, listShards, assignInstancePorts } from "@/lib/sharding";
import { initApp } from "@/lib/init";
import { hasSyncState } from "@/lib/cluster-check";
import { computeSourceTotalBytes } from "@/lib/source-stats";
import { buildConnectionString, type ConnectionConfig } from "@/lib/connection";
import { sameHostSet } from "@/lib/schemas";
import { commitStagedCerts } from "@/lib/certs";
import type { StartConfig } from "@/lib/types";
import { z } from "zod";
import { handle, jsonOk, jsonError, readJson, ApiError, maskError } from "@/lib/api";

export const GET = handle(async () => {
  initApp();
  // Attach the latest polled snapshot so the dashboard card can show a real progress bar,
  // lag, and canCommit at a glance without each card fetching live /progress itself.
  const migrations = getAllMigrations().map((m) => {
    const latest = getLatestMetric(m.id);
    // Phase-aware glimpse (phase + ETA) from the last few metrics, so the card can show
    // "Copying · 44% · ~12m left" without fetching the full series or live /progress.
    const recent = latest ? getRecentMetrics(m.id, 6) : [];
    const progress = latest
      ? toProgressGlimpse(
          computeMigrationProgress(recent, m.state, { plannedTotalBytes: m.plannedTotalBytes })
        )
      : null;
    return {
      ...m,
      copyProgress: latest?.copyProgress ?? null,
      progress,
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
  return jsonOk(migrations);
});

// Loose validation: the body accepts EITHER structured conns or legacy URI strings, plus
// an optional config blob, so we only assert the shape of what we read directly.
const createBodySchema = z.object({
  name: z.string().min(1, "name is required"),
  config: z.record(z.string(), z.unknown()).optional(),
  token: z.string().optional(),
  // Optional multi-destination group label (one source → N destinations grouped in the UI).
  groupName: z.string().min(1).optional(),
  sourceConn: z.unknown().optional(),
  destConn: z.unknown().optional(),
  sourceUri: z.unknown().optional(),
  destUri: z.unknown().optional(),
});

export const POST = handle(async (request: Request) => {
  initApp();
  const body = await readJson(request, createBodySchema);
  const { name, config, token, groupName } = body;

  // Accept EITHER structured { sourceConn, destConn } ConnectionConfigs OR legacy
  // { sourceUri, destUri } strings (treated as raw passthrough conns). Cert paths in
  // the structured conns still point at the staging area at this point.
  const sourceConn: ConnectionConfig =
    (body.sourceConn as ConnectionConfig) ??
    (typeof body.sourceUri === "string" ? { raw: body.sourceUri } : {});
  const destConn: ConnectionConfig =
    (body.destConn as ConnectionConfig) ??
    (typeof body.destUri === "string" ? { raw: body.destUri } : {});

  // Reject a migration whose source and destination resolve to the same hosts — that is
  // never a valid sync and is the key invariant for multi-destination groups (each
  // destination must differ from the shared source). Compare the built connection strings.
  if (sameHostSet(buildConnectionString(sourceConn), buildConnectionString(destConn))) {
    return jsonError("Source and destination must be different clusters.", 400);
  }

  const basePort = Number(getSetting("basePort") || "27182");
  const used = new Set(getAllMigrations().map((m) => m.port));
  let port = basePort;
  while (used.has(port)) port++;

  // Apply settings-level defaults only where the form left a field unset. The settings are
  // free-form strings; the form's `config` is the validated source of truth, so we cast the
  // merged result to StartConfig (same effective behavior as the previous untyped body).
  const merged = {
    verbosity: getSetting("defaultVerbosity") || undefined,
    loadLevel: getSetting("defaultLoadLevel") ? Number(getSetting("defaultLoadLevel")) : undefined,
    disableTelemetry: getSetting("defaultDisableTelemetry") === "true" || undefined,
    verificationEnabled:
      getSetting("defaultVerification") != null ? getSetting("defaultVerification") === "true" : undefined,
    ...(config ?? {}),
  } as StartConfig;

  // Build provisional URIs (staging cert paths) so createMigration has the required
  // sourceUri/destUri; these are rewritten below once certs are committed to a stable dir.
  const migration = createMigration({
    name,
    sourceUri: buildConnectionString(sourceConn),
    destUri: buildConnectionString(destConn),
    sourceConn: JSON.stringify(sourceConn),
    destConn: JSON.stringify(destConn),
    groupName: groupName ?? null,
    config: merged,
    port,
  });

  // Move any staged certs into the migration's permanent dir and rewrite the conn objects'
  // TLS file paths to point at the final locations. A single token covers both sides'
  // uploads; we apply the matching kind to whichever side referenced a staged file.
  const finalCerts = commitStagedCerts(token, migration.id);
  const rewriteCertPaths = (conn: ConnectionConfig): ConnectionConfig => {
    if (!conn.tls) return conn;
    const tls = { ...conn.tls };
    if (tls.caFile && finalCerts.ca) tls.caFile = finalCerts.ca;
    if (tls.certKeyFile && finalCerts.certKey) tls.certKeyFile = finalCerts.certKey;
    return { ...conn, tls };
  };
  const finalSourceConn = rewriteCertPaths(sourceConn);
  const finalDestConn = rewriteCertPaths(destConn);
  const sourceUri = buildConnectionString(finalSourceConn);
  const destUri = buildConnectionString(finalDestConn);

  // Persist final URIs + structured conns BEFORE spawning so the YAML config and all
  // mongosh helpers read the stable cert paths.
  updateMigration(migration.id, {
    sourceUri,
    destUri,
    sourceConn: JSON.stringify(finalSourceConn),
    destConn: JSON.stringify(finalDestConn),
  });
  migration.sourceUri = sourceUri;
  migration.destUri = destUri;
  migration.sourceConn = JSON.stringify(finalSourceConn);
  migration.destConn = JSON.stringify(finalDestConn);

  // Compute the stable copy-progress denominator from the source in parallel with the
  // (~30s) startup wait, so it costs no extra latency. Best-effort: null on failure.
  const plannedTotalPromise = computeSourceTotalBytes(sourceUri, merged).catch(() => null);

  // ── Sharded detection: if the SOURCE is a sharded cluster, this migration runs one
  // mongosync instance per source shard (multi-instance branch). A replica-set source
  // (listSourceShards → null) falls through to the existing single-instance path below,
  // 100% unchanged.
  const shardIds = await listSourceShards(sourceUri).catch(() => null);
  if (shardIds && shardIds.length > 0) {
    return startShardedMigration({
      migration,
      shardIds,
      basePort,
      sourceUri,
      destUri,
      merged,
      plannedTotalPromise,
    });
  }

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
          const progressBody = (await res.json().catch(() => ({}))) as ProgressResponse;
          if (progressBody.progress?.state === "IDLE") { ready = true; break; }
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

      // A common cause of "never reaches IDLE" is leftover __mdb_internal_mongosync state
      // from a prior run — on EITHER cluster. mongosync refuses to start a fresh sync when
      // it finds state whose recorded source/destination cluster ids don't match the current
      // pair (e.g. a host that was previously a destination and is now the source). Check
      // both sides and surface which, so the UI can offer to drop and retry. Best-effort.
      if (!reason && !crashed) {
        try {
          const [srcHas, dstHas] = await Promise.all([
            hasSyncState(sourceUri).catch(() => false),
            hasSyncState(destUri).catch(() => false),
          ]);
          if (srcHas || dstHas) {
            const which = [srcHas ? "source" : null, dstHas ? "destination" : null].filter(Boolean).join(" and ");
            return jsonError(
              `Leftover mongosync state (__mdb_internal_mongosync) on the ${which} from a previous run — mongosync can't start a fresh sync until it's dropped.`,
              409,
              { code: "HAS_SYNC_STATE", sides: { source: srcHas, destination: dstHas } }
            );
          }
        } catch { /* mongosh unavailable — fall through to the generic error */ }
      }

      const detail = reason
        ? `mongosync failed to start: ${reason}`
        : crashed
          ? "mongosync crash-looped on startup (see logs)"
          : "mongosync did not reach IDLE within 30s";
      return jsonError(detail, 500);
    }

    const plannedTotalBytes = await plannedTotalPromise;
    await sendCommand(port, "start", buildStartBody(migration));
    updateMigration(migration.id, { state: "RUNNING", ...(plannedTotalBytes ? { plannedTotalBytes } : {}) });
    startPoller();
    return jsonOk(getMigration(migration.id), 201);
  } catch (error) {
    // Spawn/start failed unexpectedly (e.g. mongosync's web server crashed mid-/start on a
    // privilege error). Read the real fatal from the log BEFORE teardown so the user sees an
    // actionable reason instead of a generic failure; mask any embedded connection string.
    const reason = readStartupFailure(migration.id);
    const latest = getMigration(migration.id);
    if (latest) killMongosync(latest);
    deleteMigration(migration.id);
    if (error instanceof ApiError) throw error;
    return jsonError(
      reason ? `mongosync failed to start: ${reason}` : `Failed to start migration: ${maskError(error)}`,
      500
    );
  }
});

// ── Sharded migration startup ──
// Set up + launch N mongosync instances (one per source shard), broadcast /start to all,
// and mark the migration RUNNING. Mirrors the single-instance flow but per-instance: each
// instance must reach IDLE before /start, and /start is broadcast identically to all.
async function startShardedMigration(args: {
  migration: import("@/lib/types").Migration;
  shardIds: string[];
  basePort: number;
  sourceUri: string;
  destUri: string;
  merged: StartConfig;
  plannedTotalPromise: Promise<number | null>;
}) {
  const { migration, shardIds, basePort, sourceUri, destUri, merged, plannedTotalPromise } = args;

  // reversible requires source & destination to have the SAME shard count. Probe the dest
  // mongos; if its shard count differs (or can't be determined), force reversible off so a
  // later /reverse can't be attempted on an incompatible topology.
  let cfg = merged;
  if (cfg.reversible) {
    const destShards = await listShards(destUri).catch(() => null);
    if (!destShards || destShards.length !== shardIds.length) {
      cfg = { ...cfg, reversible: false };
      updateMigration(migration.id, { config: JSON.stringify(cfg) });
      migration.config = JSON.stringify(cfg);
    }
  }

  // Assign a unique port per instance, avoiding the migration's own port and any in use.
  const used = new Set(getAllMigrations().map((m) => m.port));
  used.add(migration.port);
  const specs = assignInstancePorts(shardIds, basePort, used);
  createInstances(migration.id, specs);
  updateMigration(migration.id, { sharded: 1, instanceCount: specs.length });
  migration.sharded = 1;
  migration.instanceCount = specs.length;

  try {
    spawnShardedInstances(migration);

    // Wait for EVERY instance to reach IDLE (ready for /start). Per-instance crash-loop
    // detection bails early. Same 30s budget as the single-instance path.
    const pending = new Set(specs.map((s) => s.shardId));
    let crashed = false;
    for (let i = 0; i < 60 && pending.size > 0; i++) {
      for (const shardId of pending) {
        if (readInstanceWrapperStatus(migration.id, shardId)?.state === "crash_looping") {
          crashed = true;
          break;
        }
      }
      if (crashed) break;
      await Promise.all(
        specs
          .filter((s) => pending.has(s.shardId))
          .map(async (s) => {
            try {
              const res = await fetch(`http://localhost:${s.port}/api/v1/progress`);
              if (res.ok) {
                const body = (await res.json().catch(() => ({}))) as ProgressResponse;
                if (body.progress?.state === "IDLE") pending.delete(s.shardId);
              }
            } catch { /* not ready */ }
          })
      );
      if (pending.size > 0) await new Promise((r) => setTimeout(r, 500));
    }

    if (pending.size > 0) {
      const latest = getMigration(migration.id);
      if (latest) killShardedInstances(latest);
      deleteMigration(migration.id);
      const detail = crashed
        ? "a mongosync instance crash-looped on startup (see logs)"
        : `${pending.size} of ${specs.length} mongosync instances did not reach IDLE within 30s`;
      return jsonError(detail, 500);
    }

    const plannedTotalBytes = await plannedTotalPromise;
    await broadcastCommand(migration, "start");
    updateMigration(migration.id, { state: "RUNNING", ...(plannedTotalBytes ? { plannedTotalBytes } : {}) });
    startPoller();
    return jsonOk(getMigration(migration.id), 201);
  } catch (error) {
    const latest = getMigration(migration.id);
    if (latest) killShardedInstances(latest);
    deleteMigration(migration.id);
    if (error instanceof ApiError) throw error;
    return jsonError(`Failed to start sharded migration: ${maskError(error)}`, 500);
  }
}
