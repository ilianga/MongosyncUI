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

// Structured connection config, persisted as JSON in Migration.sourceConn/destConn.
// Defined in lib/connection.ts; re-exported here so types.ts stays the single import point.
export type { ConnectionConfig } from "./connection";

export interface Migration {
  id: string;
  name: string;
  sourceUri: string;
  destUri: string;
  /** JSON of the structured ConnectionConfig used to build sourceUri (display/edit). Null for legacy rows. */
  sourceConn?: string | null;
  /** JSON of the structured ConnectionConfig used to build destUri (display/edit). Null for legacy rows. */
  destConn?: string | null;
  config: string; // JSON of StartConfig
  state: MongosyncState;
  port: number;
  pid: number | null;
  desiredRunning: number; // 0 | 1 — SQLite has no bool
  supervisionStatus: SupervisionStatus;
  restartCount: number;
  lastExitCode: number | null;
  lastRestartAt: number | null;
  /** 1 when the user stopped the migration (process torn down, record kept for resume). */
  stopped: number;
  /**
   * Stable total bytes to copy, computed from the source at start (sum of in-scope
   * collection dataSize). Used as the copy-progress denominator instead of mongosync's
   * estimatedTotalBytes, which starts low and jumps as it discovers data. Null if it
   * couldn't be computed (then mongosync's estimate is used).
   */
  plannedTotalBytes: number | null;
  createdAt: number;
  updatedAt: number;
  /**
   * View-only: latest polled snapshot for the dashboard card glimpse. Not DB columns —
   * populated by GET /api/migrations from the most recent metric so the card can show
   * progress, lag, and canCommit without each card fetching live /progress.
   */
  copyProgress?: number | null;
  live?: MigrationLive | null;
}

/** Compact live snapshot attached to a Migration for the dashboard card. */
export interface MigrationLive {
  copyProgress: number;
  canCommit: boolean;
  lagTimeSeconds: number | null;
  totalEventsApplied: number;
  estimatedSecondsToCEACatchup: number | null;
  estimatedCopiedBytes: number;
  estimatedTotalBytes: number;
  sourcePingMs: number | null;
  destPingMs: number | null;
  updatedAt: number;
}

export interface CreateMigrationInput {
  name: string;
  sourceUri: string;
  destUri: string;
  /** JSON of the structured ConnectionConfig per side (optional; null for legacy string creates). */
  sourceConn?: string | null;
  destConn?: string | null;
  config: StartConfig;
  port: number;
}

// One polled snapshot. Wide enough to drive every chart and stat in the detail page.
export interface Metric {
  id: number;
  migrationId: string;
  state: string;
  copyProgress: number; // 0-100, derived from collectionCopy bytes
  canCommit: number; // 0 | 1 — mongosync's canCommit at poll time (SQLite has no bool)
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
