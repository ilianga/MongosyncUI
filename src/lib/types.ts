export const MONGOSYNC_STATES = [
  "IDLE",
  "RUNNING",
  "PAUSED",
  "COMMITTING",
  "COMMITTED",
  "REVERSING",
] as const;

export type MongosyncState = (typeof MONGOSYNC_STATES)[number];

export type SupervisionStatus =
  | "running"
  | "restarting"
  | "crash_looping"
  | "stopped"
  | "unsupervised";

export interface WrapperStatus {
  attempt: number;
  lastExitCode: number | null;
  lastStartAt: number;
  state: "running" | "crash_looping";
}

export interface SupervisionConfig {
  mode: "supervised" | "legacy";
  backoffCapSec: number;
  crashLoopMax: number;
  crashLoopWindowSec: number;
  hungTicks: number;
}

export type BuildIndexesMode =
  | "afterDataCopy"
  | "beforeDataCopy"
  | "excludeHashed"
  | "excludeHashedAfterCopy"
  | "never";

export type Verbosity = "TRACE" | "DEBUG" | "INFO" | "WARN" | "ERROR" | "FATAL" | "PANIC";

// One include/exclude namespace filter entry.
export interface NamespaceFilter {
  database?: string;
  databaseRegex?: { pattern: string; options?: string };
  collections?: string[];
  collectionsRegex?: { pattern: string; options?: string };
}

export interface ShardingEntry {
  database: string;
  collection: string;
  shardCollection: { key: Record<string, 1 | -1 | "hashed">[] };
}

// Everything the user configures for a sync, persisted as JSON in Migration.config.
// Split into "process" options (go to the YAML config) and "start" options (go to /start body).
export interface StartConfig {
  // /start body
  buildIndexes?: BuildIndexesMode;
  reversible?: boolean;
  detectRandomId?: boolean;
  preExistingDestinationData?: boolean;
  includeNamespaces?: NamespaceFilter[];
  excludeNamespaces?: NamespaceFilter[];
  verificationEnabled?: boolean;
  sharding?: {
    createSupportingIndexes?: boolean;
    shardingEntries: ShardingEntry[];
  };
  // process / CLI options (YAML config)
  loadLevel?: number; // 1-4
  verbosity?: Verbosity;
  createIndexesBatchSize?: number; // 1-64
  id?: string; // shard id for multi-instance sharded sync
  disableTelemetry?: boolean;
  disableVerification?: boolean;
  enableCappedCollectionHandling?: boolean;
}

export interface Migration {
  id: string;
  name: string;
  sourceUri: string;
  destUri: string;
  config: string; // JSON of StartConfig
  state: MongosyncState;
  port: number;
  pid: number | null;
  desiredRunning: number; // 0 | 1 — SQLite has no bool
  supervisionStatus: SupervisionStatus;
  restartCount: number;
  lastExitCode: number | null;
  lastRestartAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface CreateMigrationInput {
  name: string;
  sourceUri: string;
  destUri: string;
  config: StartConfig;
  port: number;
}

// One polled snapshot. Wide enough to drive every chart and stat in the detail page.
export interface Metric {
  id: number;
  migrationId: string;
  state: string;
  copyProgress: number; // 0-100, derived from collectionCopy bytes
  estimatedCopiedBytes: number;
  estimatedTotalBytes: number;
  lagTimeSeconds: number | null;
  totalEventsApplied: number;
  estimatedSecondsToCEACatchup: number | null;
  indexesBuilt: number;
  totalIndexesToBuild: number;
  sourcePingMs: number | null;
  destPingMs: number | null;
  timestamp: number;
}

export type MetricInput = Omit<Metric, "id" | "timestamp">;
