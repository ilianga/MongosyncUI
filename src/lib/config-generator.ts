import fs from "fs";
import path from "path";
import * as yaml from "js-yaml";
import { getConfigDir, getLogDir, getInstanceLogDir } from "./paths";
import type { Migration, StartConfig, Instance } from "./types";

function parseConfig(migration: Migration): StartConfig {
  return JSON.parse(migration.config) as StartConfig;
}

/**
 * Build the process-options object that becomes the mongosync YAML config. Pure: no I/O.
 * Telemetry is ALWAYS disabled (this UI never reports telemetry), regardless of what the
 * stored config says.
 */
function buildConfigObject(args: {
  cfg: StartConfig;
  cluster0: string;
  cluster1: string;
  port: number;
  logDir: string;
}): Record<string, unknown> {
  const { cfg, cluster0, cluster1, port, logDir } = args;

  const out: Record<string, unknown> = {
    cluster0,
    cluster1,
    port,
    logPath: logDir,
    metricsLoggingFilepath: logDir,
  };

  // Process / CLI options — only emit when set.
  if (cfg.verbosity !== undefined) out.verbosity = cfg.verbosity;
  if (cfg.loadLevel !== undefined) out.loadLevel = cfg.loadLevel;
  if (cfg.createIndexesBatchSize !== undefined) out.createIndexesBatchSize = cfg.createIndexesBatchSize;
  if (cfg.id !== undefined) out.id = cfg.id;
  // Telemetry is always off for this UI.
  out.disableTelemetry = true;
  if (cfg.disableVerification) out.disableVerification = true;
  if (cfg.enableCappedCollectionHandling) out.enableCappedCollectionHandling = true;

  return out;
}

/**
 * Build the `/start` request body. Pure: no I/O. Verification is ALWAYS disabled here —
 * mongosync enables the embedded verifier by default, so we explicitly turn it off unless
 * `cfg.verificationEnabled === true` (which the UI never sets today, so it is effectively
 * always false).
 */
function buildStartBodyFromConfig(cfg: StartConfig): Record<string, unknown> {
  const body: Record<string, unknown> = { source: "cluster0", destination: "cluster1" };

  if (cfg.buildIndexes !== undefined) body.buildIndexes = cfg.buildIndexes;
  if (cfg.reversible !== undefined) body.reversible = cfg.reversible;
  if (cfg.detectRandomId !== undefined) body.detectRandomId = cfg.detectRandomId;
  if (cfg.preExistingDestinationData !== undefined)
    body.preExistingDestinationData = cfg.preExistingDestinationData;
  if (cfg.includeNamespaces && cfg.includeNamespaces.length > 0)
    body.includeNamespaces = cfg.includeNamespaces;
  if (cfg.excludeNamespaces && cfg.excludeNamespaces.length > 0)
    body.excludeNamespaces = cfg.excludeNamespaces;
  if (cfg.sharding && cfg.sharding.shardingEntries.length > 0) body.sharding = cfg.sharding;
  // Verification is always disabled (only true if explicitly opted in, which never happens).
  body.verification = { enabled: cfg.verificationEnabled === true };

  return body;
}

export function generateConfig(migration: Migration): string {
  const cfg = parseConfig(migration);
  const logDir = getLogDir(migration.id);

  const out = buildConfigObject({
    cfg,
    cluster0: migration.sourceUri,
    cluster1: migration.destUri,
    port: migration.port,
    logDir,
  });

  const configPath = path.join(getConfigDir(), `${migration.id}.yaml`);
  fs.writeFileSync(configPath, yaml.dump(out), "utf-8");
  return configPath;
}

export function buildStartBody(migration: Migration): Record<string, unknown> {
  return buildStartBodyFromConfig(parseConfig(migration));
}

// ── Sharded multi-instance config generation ──
// One YAML config per instance: shared cluster0 (source mongos) / cluster1 (dest mongos),
// a unique port, `id: <shardId>`, and a per-instance log dir. The /start body is identical
// across all instances (broadcast), so it reuses the migration's buildStartBody unchanged.

function instanceConfigPath(migrationId: string, shardId: string): string {
  const safe = shardId.replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(getConfigDir(), `${migrationId}-${safe}.yaml`);
}

/**
 * Write the YAML config for ONE instance of a sharded migration and return its path.
 * cluster0/cluster1 are the shared source/dest mongos URIs; `id` is the source shard id;
 * `port` and the log dir are per-instance.
 */
export function generateInstanceConfig(migration: Migration, instance: Instance): string {
  const cfg = parseConfig(migration);
  const logDir = getInstanceLogDir(migration.id, instance.shardId);

  const out = buildConfigObject({
    // Force the instance's shard id; the migration-level cfg.id (if any) does not apply
    // per-instance — each instance must carry its own source shard id.
    cfg: { ...cfg, id: instance.shardId },
    cluster0: migration.sourceUri,
    cluster1: migration.destUri,
    port: instance.port,
    logDir,
  });

  const configPath = instanceConfigPath(migration.id, instance.shardId);
  fs.writeFileSync(configPath, yaml.dump(out), "utf-8");
  return configPath;
}

export interface ConfigPreviewInput {
  sourceUri: string;
  destUri: string;
  config: StartConfig;
  /** Illustrative port for the preview (the real port is auto-assigned at create time). */
  port?: number;
  /** Illustrative log directory for the preview. */
  logDir?: string;
}

export interface ConfigPreview {
  yaml: string;
  startBody: Record<string, unknown>;
}

/**
 * Build the YAML config + `/start` body the same way create does, WITHOUT writing any
 * file. Pure and side-effect free, so it can drive a "Show config" preview. Telemetry is
 * always off and verification is always disabled (see the shared builders above). Port and
 * log dir are illustrative only.
 */
export function buildConfigPreview(input: ConfigPreviewInput): ConfigPreview {
  const out = buildConfigObject({
    cfg: input.config,
    cluster0: input.sourceUri,
    cluster1: input.destUri,
    port: input.port ?? 27182,
    logDir: input.logDir ?? "~/.mongosync-ui/logs/<id>",
  });

  return {
    yaml: yaml.dump(out),
    startBody: buildStartBodyFromConfig(input.config),
  };
}
