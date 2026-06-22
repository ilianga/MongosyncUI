import Database from "better-sqlite3";
import path from "path";
import { nanoid } from "nanoid";
import { getDataDir } from "./paths";
import type { Migration, CreateMigrationInput, Metric, MetricInput } from "./types";

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
      estimatedCopiedBytes INTEGER NOT NULL DEFAULT 0,
      estimatedTotalBytes INTEGER NOT NULL DEFAULT 0,
      lagTimeSeconds REAL,
      totalEventsApplied INTEGER NOT NULL DEFAULT 0,
      estimatedSecondsToCEACatchup REAL,
      indexesBuilt INTEGER NOT NULL DEFAULT 0,
      totalIndexesToBuild INTEGER NOT NULL DEFAULT 0,
      sourcePingMs REAL,
      destPingMs REAL,
      timestamp INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_metrics_migration ON metrics(migrationId, timestamp);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  return db;
}

export function createMigration(input: CreateMigrationInput): Migration {
  const now = Date.now();
  const migration: Migration = {
    id: nanoid(),
    name: input.name,
    sourceUri: input.sourceUri,
    destUri: input.destUri,
    config: JSON.stringify(input.config),
    state: "IDLE",
    port: input.port,
    pid: null,
    createdAt: now,
    updatedAt: now,
  };
  getDb()
    .prepare(
      `INSERT INTO migrations (id, name, sourceUri, destUri, config, state, port, pid, createdAt, updatedAt)
       VALUES (@id, @name, @sourceUri, @destUri, @config, @state, @port, @pid, @createdAt, @updatedAt)`
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
      `INSERT INTO metrics (migrationId, state, copyProgress, estimatedCopiedBytes, estimatedTotalBytes,
         lagTimeSeconds, totalEventsApplied, estimatedSecondsToCEACatchup, indexesBuilt, totalIndexesToBuild,
         sourcePingMs, destPingMs, timestamp)
       VALUES (@migrationId, @state, @copyProgress, @estimatedCopiedBytes, @estimatedTotalBytes,
         @lagTimeSeconds, @totalEventsApplied, @estimatedSecondsToCEACatchup, @indexesBuilt, @totalIndexesToBuild,
         @sourcePingMs, @destPingMs, @timestamp)`
    )
    .run({ ...input, timestamp: Date.now() });
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
