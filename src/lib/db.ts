import Database from "better-sqlite3";
import path from "path";
import { nanoid } from "nanoid";
import { getDataDir } from "./paths";
import type {
  Migration,
  CreateMigrationInput,
  Metric,
  MetricInput,
  SavedConnection,
} from "./types";
import type { ConnectionConfig } from "./connection";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  db = new Database(path.join(getDataDir(), "data.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sourceUri TEXT NOT NULL,
      destUri TEXT NOT NULL,
      config TEXT NOT NULL DEFAULT '{}',
      state TEXT NOT NULL DEFAULT 'IDLE',
      port INTEGER NOT NULL,
      pid INTEGER,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      migrationId TEXT NOT NULL REFERENCES migrations(id) ON DELETE CASCADE,
      state TEXT NOT NULL,
      copyProgress REAL NOT NULL DEFAULT 0,
      canCommit INTEGER NOT NULL DEFAULT 0,
      estimatedCopiedBytes INTEGER NOT NULL DEFAULT 0,
      estimatedTotalBytes INTEGER NOT NULL DEFAULT 0,
      lagTimeSeconds REAL,
      totalEventsApplied INTEGER NOT NULL DEFAULT 0,
      estimatedSecondsToCEACatchup REAL,
      indexesBuilt INTEGER NOT NULL DEFAULT 0,
      totalIndexesToBuild INTEGER NOT NULL DEFAULT 0,
      sourcePingMs REAL,
      destPingMs REAL,
      cpuPercent REAL,
      rssBytes INTEGER,
      uptimeSec INTEGER,
      timestamp INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_metrics_migration ON metrics(migrationId, timestamp);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS connections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      conn TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    );
  `);
  migrateSchema(db);
  return db;
}

// Additive, idempotent column migrations. CREATE TABLE IF NOT EXISTS never alters an
// existing table, so new columns must be added explicitly and guarded against re-adding.
function migrateSchema(database: Database.Database): void {
  const cols = new Set(
    (database.prepare("PRAGMA table_info(migrations)").all() as { name: string }[]).map((c) => c.name)
  );
  const add = (name: string, ddl: string) => {
    if (!cols.has(name)) database.exec(`ALTER TABLE migrations ADD COLUMN ${ddl}`);
  };
  add("desiredRunning", "desiredRunning INTEGER NOT NULL DEFAULT 0");
  add("supervisionStatus", "supervisionStatus TEXT NOT NULL DEFAULT 'stopped'");
  add("restartCount", "restartCount INTEGER NOT NULL DEFAULT 0");
  add("lastExitCode", "lastExitCode INTEGER");
  add("lastRestartAt", "lastRestartAt INTEGER");
  add("stopped", "stopped INTEGER NOT NULL DEFAULT 0");
  add("plannedTotalBytes", "plannedTotalBytes INTEGER");
  add("sourceConn", "sourceConn TEXT");
  add("destConn", "destConn TEXT");

  // metrics table: additive columns added after the original schema.
  const metricCols = new Set(
    (database.prepare("PRAGMA table_info(metrics)").all() as { name: string }[]).map((c) => c.name)
  );
  if (!metricCols.has("canCommit")) {
    database.exec("ALTER TABLE metrics ADD COLUMN canCommit INTEGER NOT NULL DEFAULT 0");
  }
  if (!metricCols.has("cpuPercent")) {
    database.exec("ALTER TABLE metrics ADD COLUMN cpuPercent REAL");
  }
  if (!metricCols.has("rssBytes")) {
    database.exec("ALTER TABLE metrics ADD COLUMN rssBytes INTEGER");
  }
  if (!metricCols.has("uptimeSec")) {
    database.exec("ALTER TABLE metrics ADD COLUMN uptimeSec INTEGER");
  }
}

export function createMigration(input: CreateMigrationInput): Migration {
  const now = Date.now();
  const migration: Migration = {
    id: nanoid(),
    name: input.name,
    sourceUri: input.sourceUri,
    destUri: input.destUri,
    sourceConn: input.sourceConn ?? null,
    destConn: input.destConn ?? null,
    config: JSON.stringify(input.config),
    state: "IDLE",
    port: input.port,
    pid: null,
    desiredRunning: 0,
    supervisionStatus: "stopped",
    restartCount: 0,
    lastExitCode: null,
    lastRestartAt: null,
    stopped: 0,
    plannedTotalBytes: null,
    createdAt: now,
    updatedAt: now,
  };
  getDb()
    .prepare(
      `INSERT INTO migrations (id, name, sourceUri, destUri, sourceConn, destConn, config, state, port, pid,
         desiredRunning, supervisionStatus, restartCount, lastExitCode, lastRestartAt, stopped, plannedTotalBytes, createdAt, updatedAt)
       VALUES (@id, @name, @sourceUri, @destUri, @sourceConn, @destConn, @config, @state, @port, @pid,
         @desiredRunning, @supervisionStatus, @restartCount, @lastExitCode, @lastRestartAt, @stopped, @plannedTotalBytes, @createdAt, @updatedAt)`
    )
    .run(migration);
  return migration;
}

export function getMigration(id: string): Migration | undefined {
  return getDb().prepare("SELECT * FROM migrations WHERE id = ?").get(id) as Migration | undefined;
}

export function getAllMigrations(): Migration[] {
  return getDb().prepare("SELECT * FROM migrations ORDER BY createdAt DESC").all() as Migration[];
}

export function updateMigration(id: string, data: Partial<Migration>): void {
  const keys = Object.keys(data).filter((k) => k !== "id");
  if (keys.length === 0) return;
  const fields = keys.map((k) => `${k} = @${k}`).join(", ");
  getDb()
    .prepare(`UPDATE migrations SET ${fields}, updatedAt = @updatedAt WHERE id = @id`)
    .run({ ...data, id, updatedAt: Date.now() });
}

export function deleteMigration(id: string): void {
  getDb().prepare("DELETE FROM migrations WHERE id = ?").run(id);
}

export function insertMetric(input: MetricInput): void {
  getDb()
    .prepare(
      `INSERT INTO metrics (migrationId, state, copyProgress, canCommit, estimatedCopiedBytes, estimatedTotalBytes,
         lagTimeSeconds, totalEventsApplied, estimatedSecondsToCEACatchup, indexesBuilt, totalIndexesToBuild,
         sourcePingMs, destPingMs, cpuPercent, rssBytes, uptimeSec, timestamp)
       VALUES (@migrationId, @state, @copyProgress, @canCommit, @estimatedCopiedBytes, @estimatedTotalBytes,
         @lagTimeSeconds, @totalEventsApplied, @estimatedSecondsToCEACatchup, @indexesBuilt, @totalIndexesToBuild,
         @sourcePingMs, @destPingMs, @cpuPercent, @rssBytes, @uptimeSec, @timestamp)`
    )
    .run({ ...input, timestamp: Date.now() });
}

export function getLatestMetric(migrationId: string): Metric | undefined {
  return getDb()
    .prepare("SELECT * FROM metrics WHERE migrationId = ? ORDER BY timestamp DESC LIMIT 1")
    .get(migrationId) as Metric | undefined;
}

/**
 * Return the most recent `n` metrics in chronological (ascending) order. Used by the card
 * enrichment to compute a phase-aware progress glimpse (copy throughput / lag trend) without
 * loading the full series.
 */
export function getRecentMetrics(migrationId: string, n: number): Metric[] {
  const rows = getDb()
    .prepare("SELECT * FROM metrics WHERE migrationId = ? ORDER BY timestamp DESC LIMIT ?")
    .all(migrationId, n) as Metric[];
  return rows.reverse();
}

export function getMetrics(migrationId: string, since?: number): Metric[] {
  if (since !== undefined) {
    return getDb()
      .prepare("SELECT * FROM metrics WHERE migrationId = ? AND timestamp >= ? ORDER BY timestamp ASC")
      .all(migrationId, since) as Metric[];
  }
  return getDb()
    .prepare("SELECT * FROM metrics WHERE migrationId = ? ORDER BY timestamp ASC")
    .all(migrationId) as Metric[];
}

export function getSetting(key: string): string | undefined {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string } | undefined;
  return row?.value;
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    )
    .run(key, value);
}

// ── Saved connections (reusable, colour-tagged) ──
// Stored with `conn` as a JSON string; the helpers below parse it back to a structured
// ConnectionConfig so callers always see a typed SavedConnection.

interface SavedConnectionRow {
  id: string;
  name: string;
  color: string;
  conn: string;
  createdAt: number;
  updatedAt: number;
}

function rowToSavedConnection(row: SavedConnectionRow): SavedConnection {
  let conn: ConnectionConfig = {};
  try {
    conn = JSON.parse(row.conn) as ConnectionConfig;
  } catch {
    /* corrupt JSON — fall back to empty config */
  }
  return { ...row, conn };
}

export function getConnections(): SavedConnection[] {
  const rows = getDb()
    .prepare("SELECT * FROM connections ORDER BY createdAt DESC")
    .all() as SavedConnectionRow[];
  return rows.map(rowToSavedConnection);
}

export function getSavedConnection(id: string): SavedConnection | undefined {
  const row = getDb().prepare("SELECT * FROM connections WHERE id = ?").get(id) as
    | SavedConnectionRow
    | undefined;
  return row ? rowToSavedConnection(row) : undefined;
}

export function createSavedConnection(input: {
  name: string;
  color: string;
  conn: ConnectionConfig;
}): SavedConnection {
  const now = Date.now();
  const saved: SavedConnection = {
    id: nanoid(),
    name: input.name,
    color: input.color,
    conn: input.conn,
    createdAt: now,
    updatedAt: now,
  };
  getDb()
    .prepare(
      `INSERT INTO connections (id, name, color, conn, createdAt, updatedAt)
       VALUES (@id, @name, @color, @conn, @createdAt, @updatedAt)`
    )
    .run({ ...saved, conn: JSON.stringify(saved.conn) });
  return saved;
}

export function updateSavedConnection(
  id: string,
  partial: { name?: string; color?: string; conn?: ConnectionConfig }
): SavedConnection | undefined {
  const existing = getSavedConnection(id);
  if (!existing) return undefined;
  const next: SavedConnection = {
    ...existing,
    name: partial.name ?? existing.name,
    color: partial.color ?? existing.color,
    conn: partial.conn ?? existing.conn,
    updatedAt: Date.now(),
  };
  getDb()
    .prepare(
      "UPDATE connections SET name = @name, color = @color, conn = @conn, updatedAt = @updatedAt WHERE id = @id"
    )
    .run({ ...next, conn: JSON.stringify(next.conn) });
  return next;
}

export function deleteSavedConnection(id: string): void {
  getDb().prepare("DELETE FROM connections WHERE id = ?").run(id);
}
