import fs from "fs";
import path from "path";
import * as yaml from "js-yaml";
import { getConfigDir, getLogDir } from "./paths";
import type { Migration, StartConfig } from "./types";

function parseConfig(migration: Migration): StartConfig {
  return JSON.parse(migration.config) as StartConfig;
}

export function generateConfig(migration: Migration): string {
  const cfg = parseConfig(migration);
  const logDir = getLogDir(migration.id);

  const out: Record<string, unknown> = {
    cluster0: migration.sourceUri,
    cluster1: migration.destUri,
    port: migration.port,
    logPath: logDir,
    metricsLoggingFilepath: logDir,
  };

  // Process / CLI options — only emit when set.
  if (cfg.verbosity !== undefined) out.verbosity = cfg.verbosity;
  if (cfg.loadLevel !== undefined) out.loadLevel = cfg.loadLevel;
  if (cfg.createIndexesBatchSize !== undefined) out.createIndexesBatchSize = cfg.createIndexesBatchSize;
  if (cfg.id !== undefined) out.id = cfg.id;
  if (cfg.disableTelemetry) out.disableTelemetry = true;
  if (cfg.disableVerification) out.disableVerification = true;
  if (cfg.enableCappedCollectionHandling) out.enableCappedCollectionHandling = true;

  const configPath = path.join(getConfigDir(), `${migration.id}.yaml`);
  fs.writeFileSync(configPath, yaml.dump(out), "utf-8");
  return configPath;
}

export function buildStartBody(migration: Migration): Record<string, unknown> {
  const cfg = parseConfig(migration);
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
  if (cfg.verificationEnabled !== undefined)
    body.verification = { enabled: cfg.verificationEnabled };

  return body;
}
