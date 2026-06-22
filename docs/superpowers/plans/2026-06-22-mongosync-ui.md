# MongosyncUI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local Next.js web app that generates mongosync configs, spawns/manages mongosync processes, and provides full migration lifecycle control plus live monitoring with historical metric charts.

**Architecture:** Next.js App Router full-stack app. API routes manage mongosync child processes, generate YAML configs, and proxy commands to each process's HTTP API (`/api/v1/*`). SQLite stores migration definitions, settings, and metric snapshots. A server-side poller calls `GET /progress` every 5s on active migrations and writes metric rows. The client polls our own API every 5s for live UI updates.

**Tech Stack:** Next.js 14+ (App Router), TypeScript, Tailwind CSS, shadcn/ui, recharts, react-hook-form, zod, better-sqlite3, nanoid, js-yaml

## Global Constraints

- TypeScript strict mode throughout.
- All runtime data stored in `~/.mongosync-ui/` (`data.db`, `configs/`, `logs/<id>/`); override dir via `MONGOSYNC_UI_DIR` env (used by tests).
- No authentication, no WebSockets, no daemon. Polling runs only while the Next.js server runs.
- shadcn/ui for all UI components — no custom design system.
- One mongosync process per migration, each on its own port auto-assigned starting at 27182.
- Mongosync HTTP API base: `http://localhost:{port}/api/v1/`.
- **Mongosync API is the source of truth.** Field names and values must match the official docs exactly:
  - `/start` body fields: `source`, `destination`, `buildIndexes`, `reversible`, `detectRandomId`, `copyInNaturalOrder`, `preExistingDestinationData`, `includeNamespaces`, `excludeNamespaces`, `sharding`, `verification`.
  - `buildIndexes` values: `afterDataCopy` | `beforeDataCopy` | `excludeHashed` | `excludeHashedAfterCopy` | `never`.
  - Namespace filter entry: `database` **or** `databaseRegex {pattern, options}`; optional `collections` (string array) and/or `collectionsRegex {pattern, options}`.
  - There is **no** `enableUserWriteBlocking` start field — write blocking happens automatically at commit. Do not invent it.
  - `/progress` direction keys are capitalized: `directionMapping.Source`, `directionMapping.Destination`.
  - CLI flags live in the generated config file (never on the command line, to avoid leaking passwords): `cluster0`, `cluster1`, `port`, `logPath`, `verbosity`, `loadLevel`, `metricsLoggingFilepath`, `createIndexesBatchSize`, `id`, `disableTelemetry`, `disableMetricsLogging`, `disableVerification`, `enableCappedCollectionHandling`, `acceptDisclaimer`.
- mongosync states: `IDLE`, `RUNNING`, `PAUSED`, `COMMITTING`, `COMMITTED`, `REVERSING` (plus transient `INITIALIZING` before IDLE).

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/lib/types.ts` | All shared TypeScript types and the `MONGOSYNC_STATES` tuple. |
| `src/lib/paths.ts` | Resolve data dir, config dir, per-migration log dir. Single source of path truth. |
| `src/lib/db.ts` | SQLite singleton + CRUD for migrations, metrics, settings. |
| `src/lib/config-generator.ts` | Build the YAML process config and the `/start` request body from a migration's stored config. |
| `src/lib/process-manager.ts` | Spawn/kill mongosync, send API commands, fetch progress, liveness check. |
| `src/lib/cluster-check.ts` | Test connectivity + read MongoDB version of a cluster URI (via `mongosh`/driver-free ping). |
| `src/lib/poller.ts` | Global interval that polls active migrations and records metrics. |
| `src/lib/init.ts` | One-time startup: reconcile dead PIDs, auto-detect binary, start poller. |
| `src/lib/schemas.ts` | zod schemas — source of truth for the form and the `/start` config shape. |
| `src/app/api/**` | REST endpoints (migrations CRUD + actions, metrics, settings, mongosync version, cluster check, logs). |
| `src/components/*` | UI: state badge, action buttons, cards, form, charts, progress panels, logs panel, pre-commit checklist. |
| `src/app/**/page.tsx` | Dashboard, new-migration, detail, settings pages. |

Tasks are ordered so each produces an independently testable deliverable. Library tasks (1–4) are unit-tested with vitest; UI tasks (5–9) are verified by build + smoke render.

---

### Task 1: Scaffolding + Paths + SQLite Database Layer

**Files:**
- Create: `package.json`, `tsconfig.json`, `tailwind.config.ts`, `next.config.ts`, `postcss.config.mjs`, `vitest.config.ts` (via tooling)
- Create: `src/lib/types.ts`
- Create: `src/lib/paths.ts`
- Create: `src/lib/db.ts`
- Create: `src/app/layout.tsx`, `src/app/page.tsx` (placeholder)
- Test: `src/lib/__tests__/db.test.ts`

**Interfaces:**
- Consumes: nothing (first task)
- Produces:
  - `paths.ts`: `getDataDir(): string`, `getConfigDir(): string`, `getLogDir(id: string): string`
  - `db.ts`: `getDb()`, `createMigration(input: CreateMigrationInput): Migration`, `getMigration(id): Migration | undefined`, `getAllMigrations(): Migration[]`, `updateMigration(id, data: Partial<Migration>): void`, `deleteMigration(id): void`, `insertMetric(input: MetricInput): void`, `getMetrics(migrationId, since?): Metric[]`, `getSetting(key): string | undefined`, `setSetting(key, value): void`
  - `types.ts`: `MongosyncState`, `Migration`, `CreateMigrationInput`, `Metric`, `MetricInput`, `StartConfig`, `NamespaceFilter`, `ShardingEntry`

- [ ] **Step 1: Initialize Next.js project**

```bash
cd /Users/ilian/Dev/MongosyncUI
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --no-turbopack
```

Accept overwriting existing files if prompted (keep `CLAUDE.md`, `docs/`, `.gitignore`). This scaffolds `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `postcss.config.mjs`, and `src/app/`.

- [ ] **Step 2: Install dependencies**

```bash
npm install better-sqlite3 nanoid js-yaml recharts react-hook-form @hookform/resolvers zod
npm install -D @types/better-sqlite3 @types/js-yaml vitest
```

- [ ] **Step 3: Add vitest config and scripts**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: { globals: true, environment: "node" },
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
});
```

Add to `package.json` `scripts`: `"test": "vitest run"`, `"test:watch": "vitest"`.

- [ ] **Step 4: Define shared types**

Create `src/lib/types.ts`:

```ts
export const MONGOSYNC_STATES = [
  "IDLE",
  "RUNNING",
  "PAUSED",
  "COMMITTING",
  "COMMITTED",
  "REVERSING",
] as const;

export type MongosyncState = (typeof MONGOSYNC_STATES)[number];

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
  shardCollection: { key: Record<string, 1 | "hashed">[] };
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
```

- [ ] **Step 5: Implement the paths module**

Create `src/lib/paths.ts`:

```ts
import path from "path";
import os from "os";
import fs from "fs";

export function getDataDir(): string {
  const dir = process.env.MONGOSYNC_UI_DIR || path.join(os.homedir(), ".mongosync-ui");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getConfigDir(): string {
  const dir = path.join(getDataDir(), "configs");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getLogDir(migrationId: string): string {
  const dir = path.join(getDataDir(), "logs", migrationId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
```

- [ ] **Step 6: Write failing tests for db module**

Create `src/lib/__tests__/db.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "path";
import fs from "fs";
import os from "os";

let testDir: string;
let originalEnv: string | undefined;

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), "mongosync-ui-test-"));
  originalEnv = process.env.MONGOSYNC_UI_DIR;
  process.env.MONGOSYNC_UI_DIR = testDir;
  vi.resetModules();
});

afterEach(() => {
  process.env.MONGOSYNC_UI_DIR = originalEnv;
  fs.rmSync(testDir, { recursive: true, force: true });
});

async function loadDb() {
  return await import("@/lib/db");
}

describe("db", () => {
  it("creates tables on first access", async () => {
    const { getDb } = await loadDb();
    const names = (getDb()
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[]).map((t) => t.name);
    expect(names).toContain("migrations");
    expect(names).toContain("metrics");
    expect(names).toContain("settings");
  });

  it("creates, retrieves, and lists migrations", async () => {
    const { createMigration, getMigration, getAllMigrations } = await loadDb();
    const m = createMigration({
      name: "test",
      sourceUri: "mongodb://src:27017",
      destUri: "mongodb://dst:27017",
      config: { reversible: true },
      port: 27182,
    });
    expect(m.id).toBeTruthy();
    expect(m.state).toBe("IDLE");
    expect(m.pid).toBeNull();
    expect(getMigration(m.id)).toEqual(m);
    expect(getAllMigrations()).toHaveLength(1);
  });

  it("updates and deletes a migration", async () => {
    const { createMigration, updateMigration, getMigration, deleteMigration } = await loadDb();
    const m = createMigration({
      name: "m", sourceUri: "mongodb://a", destUri: "mongodb://b", config: {}, port: 27182,
    });
    updateMigration(m.id, { state: "RUNNING", pid: 12345 });
    const updated = getMigration(m.id)!;
    expect(updated.state).toBe("RUNNING");
    expect(updated.pid).toBe(12345);
    deleteMigration(m.id);
    expect(getMigration(m.id)).toBeUndefined();
  });

  it("inserts and retrieves metrics, cascading on delete", async () => {
    const { createMigration, insertMetric, getMetrics, deleteMigration } = await loadDb();
    const m = createMigration({
      name: "m", sourceUri: "mongodb://a", destUri: "mongodb://b", config: {}, port: 27182,
    });
    insertMetric({
      migrationId: m.id, state: "RUNNING", copyProgress: 42.5,
      estimatedCopiedBytes: 5000, estimatedTotalBytes: 10000,
      lagTimeSeconds: 3, totalEventsApplied: 1000, estimatedSecondsToCEACatchup: 12,
      indexesBuilt: 1, totalIndexesToBuild: 4, sourcePingMs: 12, destPingMs: 20,
    });
    const metrics = getMetrics(m.id);
    expect(metrics).toHaveLength(1);
    expect(metrics[0].copyProgress).toBe(42.5);
    expect(metrics[0].indexesBuilt).toBe(1);
    deleteMigration(m.id);
    expect(getMetrics(m.id)).toHaveLength(0);
  });

  it("gets and sets settings (upsert)", async () => {
    const { getSetting, setSetting } = await loadDb();
    expect(getSetting("mongosyncPath")).toBeUndefined();
    setSetting("mongosyncPath", "/usr/local/bin/mongosync");
    expect(getSetting("mongosyncPath")).toBe("/usr/local/bin/mongosync");
    setSetting("mongosyncPath", "/opt/mongosync");
    expect(getSetting("mongosyncPath")).toBe("/opt/mongosync");
  });
});
```

- [ ] **Step 7: Run tests to verify they fail**

```bash
npx vitest run src/lib/__tests__/db.test.ts
```

Expected: FAIL — `@/lib/db` does not exist.

- [ ] **Step 8: Implement db module**

Create `src/lib/db.ts`:

```ts
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
```

- [ ] **Step 9: Run tests to verify they pass**

```bash
npx vitest run src/lib/__tests__/db.test.ts
```

Expected: all 5 tests PASS.

- [ ] **Step 10: Install shadcn/ui + components**

```bash
npx shadcn@latest init -d
npx shadcn@latest add button card input label select slider badge table dialog tabs collapsible toast switch textarea separator tooltip progress alert checkbox
```

- [ ] **Step 11: Create layout shell + placeholder dashboard**

Replace `src/app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "MongosyncUI",
  description: "Manage MongoDB cluster-to-cluster migrations",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <div className="min-h-screen bg-background">
          <header className="border-b">
            <div className="container mx-auto flex h-14 items-center px-4">
              <a href="/" className="text-lg font-semibold">MongosyncUI</a>
              <nav className="ml-auto flex gap-4">
                <a href="/" className="text-sm text-muted-foreground hover:text-foreground">Dashboard</a>
                <a href="/settings" className="text-sm text-muted-foreground hover:text-foreground">Settings</a>
              </nav>
            </div>
          </header>
          <main className="container mx-auto px-4 py-6">{children}</main>
        </div>
        <Toaster />
      </body>
    </html>
  );
}
```

Replace `src/app/page.tsx`:

```tsx
export default function DashboardPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <p className="text-muted-foreground">No migrations yet.</p>
    </div>
  );
}
```

- [ ] **Step 12: Verify app boots**

```bash
npm run dev &
sleep 3
curl -s http://localhost:3000 | grep -o "MongosyncUI" | head -1
kill %1
```

Expected: prints `MongosyncUI`.

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "feat: scaffolding, paths, SQLite layer, and shadcn/ui setup"
```

---

### Task 2: Config Generator (full CLI + /start options)

**Files:**
- Create: `src/lib/config-generator.ts`
- Test: `src/lib/__tests__/config-generator.test.ts`

**Interfaces:**
- Consumes: `Migration`, `StartConfig` (Task 1); `getConfigDir()`, `getLogDir()` (Task 1)
- Produces:
  - `generateConfig(migration: Migration): string` — writes `<configDir>/<id>.yaml`, returns its path. Contains `cluster0`, `cluster1`, `port`, `logPath`, plus any process options present in config.
  - `buildStartBody(migration: Migration): Record<string, unknown>` — builds the `/start` body with `source`/`destination` plus only the start-time options present in config, using correct field names/values.

- [ ] **Step 1: Write failing tests**

Create `src/lib/__tests__/config-generator.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import yaml from "js-yaml";
import type { Migration, StartConfig } from "@/lib/types";

let testDir: string;
let originalEnv: string | undefined;

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), "mongosync-ui-test-"));
  originalEnv = process.env.MONGOSYNC_UI_DIR;
  process.env.MONGOSYNC_UI_DIR = testDir;
  vi.resetModules();
});

afterEach(() => {
  process.env.MONGOSYNC_UI_DIR = originalEnv;
  fs.rmSync(testDir, { recursive: true, force: true });
});

async function load() {
  return await import("@/lib/config-generator");
}

function migrationWith(config: StartConfig): Migration {
  return {
    id: "abc123",
    name: "test",
    sourceUri: "mongodb://src:27017",
    destUri: "mongodb://dst:27017",
    config: JSON.stringify(config),
    state: "IDLE",
    port: 27183,
    pid: null,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("generateConfig", () => {
  it("writes a YAML config with connection, port, and logPath", async () => {
    const { generateConfig } = await load();
    const p = generateConfig(migrationWith({ loadLevel: 4, verbosity: "DEBUG" }));
    expect(fs.existsSync(p)).toBe(true);
    const cfg = yaml.load(fs.readFileSync(p, "utf-8")) as Record<string, unknown>;
    expect(cfg.cluster0).toBe("mongodb://src:27017");
    expect(cfg.cluster1).toBe("mongodb://dst:27017");
    expect(cfg.port).toBe(27183);
    expect(cfg.logPath).toContain("abc123");
    expect(cfg.loadLevel).toBe(4);
    expect(cfg.verbosity).toBe("DEBUG");
  });

  it("omits process options that are not set", async () => {
    const { generateConfig } = await load();
    const p = generateConfig(migrationWith({}));
    const cfg = yaml.load(fs.readFileSync(p, "utf-8")) as Record<string, unknown>;
    expect(cfg).not.toHaveProperty("loadLevel");
    expect(cfg).not.toHaveProperty("createIndexesBatchSize");
    expect(cfg).not.toHaveProperty("id");
  });

  it("includes optional process flags when set", async () => {
    const { generateConfig } = await load();
    const p = generateConfig(
      migrationWith({
        createIndexesBatchSize: 16,
        id: "shard0",
        disableTelemetry: true,
        disableVerification: true,
        enableCappedCollectionHandling: true,
      })
    );
    const cfg = yaml.load(fs.readFileSync(p, "utf-8")) as Record<string, unknown>;
    expect(cfg.createIndexesBatchSize).toBe(16);
    expect(cfg.id).toBe("shard0");
    expect(cfg.disableTelemetry).toBe(true);
    expect(cfg.disableVerification).toBe(true);
    expect(cfg.enableCappedCollectionHandling).toBe(true);
  });
});

describe("buildStartBody", () => {
  it("always sets source and destination", async () => {
    const { buildStartBody } = await load();
    const body = buildStartBody(migrationWith({}));
    expect(body.source).toBe("cluster0");
    expect(body.destination).toBe("cluster1");
  });

  it("passes through start-time options with correct names", async () => {
    const { buildStartBody } = await load();
    const body = buildStartBody(
      migrationWith({
        reversible: true,
        buildIndexes: "afterDataCopy",
        detectRandomId: false,
        preExistingDestinationData: true,
        verificationEnabled: false,
      })
    );
    expect(body.reversible).toBe(true);
    expect(body.buildIndexes).toBe("afterDataCopy");
    expect(body.detectRandomId).toBe(false);
    expect(body.preExistingDestinationData).toBe(true);
    expect(body.verification).toEqual({ enabled: false });
  });

  it("maps namespace filters verbatim (database/collections/regex)", async () => {
    const { buildStartBody } = await load();
    const body = buildStartBody(
      migrationWith({
        includeNamespaces: [
          { database: "sales", collections: ["EMEA", "APAC"] },
          { databaseRegex: { pattern: "^analytics_", options: "i" } },
        ],
        excludeNamespaces: [{ database: "sales", collections: ["accounts_old"] }],
      })
    );
    expect(body.includeNamespaces).toEqual([
      { database: "sales", collections: ["EMEA", "APAC"] },
      { databaseRegex: { pattern: "^analytics_", options: "i" } },
    ]);
    expect(body.excludeNamespaces).toEqual([{ database: "sales", collections: ["accounts_old"] }]);
  });

  it("includes sharding config when present", async () => {
    const { buildStartBody } = await load();
    const body = buildStartBody(
      migrationWith({
        sharding: {
          createSupportingIndexes: true,
          shardingEntries: [
            { database: "db", collection: "c", shardCollection: { key: [{ userId: 1 }] } },
          ],
        },
      })
    );
    expect(body.sharding).toEqual({
      createSupportingIndexes: true,
      shardingEntries: [
        { database: "db", collection: "c", shardCollection: { key: [{ userId: 1 }] } },
      ],
    });
  });

  it("never emits an enableUserWriteBlocking field", async () => {
    const { buildStartBody } = await load();
    const body = buildStartBody(migrationWith({ reversible: true }));
    expect(body).not.toHaveProperty("enableUserWriteBlocking");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/lib/__tests__/config-generator.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement config-generator**

Create `src/lib/config-generator.ts`:

```ts
import fs from "fs";
import path from "path";
import yaml from "js-yaml";
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/lib/__tests__/config-generator.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: config generator for mongosync YAML config and /start body"
```

---

### Task 3: Process Manager + Cluster Connectivity/Version Check

**Files:**
- Create: `src/lib/process-manager.ts`
- Create: `src/lib/cluster-check.ts`
- Test: `src/lib/__tests__/process-manager.test.ts`
- Test: `src/lib/__tests__/cluster-check.test.ts`

**Interfaces:**
- Consumes: `Migration` (Task 1); `getSetting`, `updateMigration` (Task 1); `generateConfig` (Task 2); `getLogDir` (Task 1)
- Produces:
  - `isProcessAlive(pid: number): boolean`
  - `spawnMongosync(migration: Migration): number` — writes config, spawns detached process, stores PID, returns PID
  - `killMongosync(migration: Migration): void`
  - `sendCommand(port, endpoint, body?): Promise<unknown>` — POST to `/api/v1/<endpoint>`; throws on non-2xx or `success:false`
  - `fetchProgress(port: number): Promise<ProgressResponse>` — GET `/api/v1/progress`
  - `ProgressResponse` type (full shape used by poller + detail page)
  - `cluster-check.ts`: `parseMongoUri(uri: string): { hosts: string[] }`, `checkCluster(uri: string): Promise<ClusterCheck>` where `ClusterCheck = { reachable: boolean; version?: string; error?: string }`

- [ ] **Step 1: Define the ProgressResponse type and write process-manager tests**

Create `src/lib/__tests__/process-manager.test.ts`:

```ts
import { describe, it, expect } from "vitest";

async function load() {
  return await import("@/lib/process-manager");
}

describe("process-manager liveness", () => {
  it("isProcessAlive returns false for a non-existent PID", async () => {
    const { isProcessAlive } = await load();
    expect(isProcessAlive(99999999)).toBe(false);
  });

  it("isProcessAlive returns true for the current process", async () => {
    const { isProcessAlive } = await load();
    expect(isProcessAlive(process.pid)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/lib/__tests__/process-manager.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement process-manager**

Create `src/lib/process-manager.ts`:

```ts
import { spawn } from "node:child_process";
import fs from "fs";
import path from "path";
import type { Migration } from "./types";
import { generateConfig } from "./config-generator";
import { getLogDir } from "./paths";
import { getSetting, updateMigration } from "./db";

// Mirrors GET /api/v1/progress. All numeric fields optional — mongosync omits
// them depending on phase. The poller normalizes to the Metric shape.
export interface ProgressResponse {
  success: boolean;
  error?: string;
  errorDescription?: string;
  progress?: {
    state: string;
    canCommit: boolean;
    canWrite: boolean;
    info?: string;
    lagTimeSeconds?: number | null;
    totalEventsApplied?: number;
    estimatedSecondsToCEACatchup?: number;
    estimatedOplogTimeRemaining?: string;
    collectionCopy?: { estimatedCopiedBytes?: number; estimatedTotalBytes?: number };
    indexBuilding?: {
      indexesBuilt?: number;
      totalIndexesToBuild?: number;
      collectionsFinished?: number;
      collectionsTotal?: number;
    };
    directionMapping?: { Source?: string; Destination?: string };
    source?: { pingLatencyMs?: number };
    destination?: { pingLatencyMs?: number };
    mongosyncID?: string;
    coordinatorID?: string;
    warnings?: string[];
    verification?: {
      source?: VerificationSide;
      destination?: VerificationSide;
    };
  };
}

export interface VerificationSide {
  phase?: string;
  estimatedDocumentCount?: number;
  hashedDocumentCount?: number;
  scannedCollectionCount?: number;
  totalCollectionCount?: number;
  lagTimeSeconds?: number;
}

function getMongosyncPath(): string {
  return getSetting("mongosyncPath") || "mongosync";
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function spawnMongosync(migration: Migration): number {
  const configPath = generateConfig(migration);
  const logDir = getLogDir(migration.id);
  const child = spawn(getMongosyncPath(), ["--config", configPath], {
    detached: true,
    stdio: [
      "ignore",
      fs.openSync(path.join(logDir, "stdout.log"), "a"),
      fs.openSync(path.join(logDir, "stderr.log"), "a"),
    ],
  });
  child.unref();
  const pid = child.pid!;
  updateMigration(migration.id, { pid });
  return pid;
}

export function killMongosync(migration: Migration): void {
  if (migration.pid && isProcessAlive(migration.pid)) {
    try {
      process.kill(migration.pid, "SIGTERM");
    } catch {
      // already gone
    }
  }
  updateMigration(migration.id, { pid: null });
}

export async function sendCommand(
  port: number,
  endpoint: string,
  body: Record<string, unknown> = {}
): Promise<unknown> {
  const res = await fetch(`http://localhost:${port}/api/v1/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    error?: string;
    errorDescription?: string;
  };
  if (!res.ok || json.success === false) {
    throw new Error(json.errorDescription || json.error || `mongosync ${endpoint} failed (${res.status})`);
  }
  return json;
}

export async function fetchProgress(port: number): Promise<ProgressResponse> {
  const res = await fetch(`http://localhost:${port}/api/v1/progress`);
  if (!res.ok) throw new Error(`mongosync progress failed (${res.status})`);
  return (await res.json()) as ProgressResponse;
}
```

- [ ] **Step 4: Run process-manager tests**

```bash
npx vitest run src/lib/__tests__/process-manager.test.ts
```

Expected: both tests PASS.

- [ ] **Step 5: Write failing tests for cluster-check**

Create `src/lib/__tests__/cluster-check.test.ts`:

```ts
import { describe, it, expect } from "vitest";

async function load() {
  return await import("@/lib/cluster-check");
}

describe("parseMongoUri", () => {
  it("extracts a single host:port", async () => {
    const { parseMongoUri } = await load();
    expect(parseMongoUri("mongodb://user:pass@host1:27017/db").hosts).toEqual(["host1:27017"]);
  });

  it("extracts multiple hosts from a replica set URI", async () => {
    const { parseMongoUri } = await load();
    expect(parseMongoUri("mongodb://h1:27017,h2:27018,h3:27019/?replicaSet=rs0").hosts).toEqual([
      "h1:27017",
      "h2:27018",
      "h3:27019",
    ]);
  });

  it("defaults port 27017 when omitted", async () => {
    const { parseMongoUri } = await load();
    expect(parseMongoUri("mongodb://localhost/test").hosts).toEqual(["localhost:27017"]);
  });

  it("handles mongodb+srv by returning the srv host", async () => {
    const { parseMongoUri } = await load();
    expect(parseMongoUri("mongodb+srv://user:pass@cluster.mongodb.net/db").hosts).toEqual([
      "cluster.mongodb.net:27017",
    ]);
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

```bash
npx vitest run src/lib/__tests__/cluster-check.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 7: Implement cluster-check**

mongosync needs no MongoDB driver, so we avoid adding one. `checkCluster` does a raw TCP connect to the first host (reachability) and, when the `mongosh` binary is available, reads the server version. Connectivity alone is enough to block a clearly-broken URI in the form.

Create `src/lib/cluster-check.ts`:

```ts
import net from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface ClusterCheck {
  reachable: boolean;
  version?: string;
  error?: string;
}

export function parseMongoUri(uri: string): { hosts: string[] } {
  const withoutScheme = uri.replace(/^mongodb(\+srv)?:\/\//, "");
  const afterAuth = withoutScheme.includes("@")
    ? withoutScheme.slice(withoutScheme.indexOf("@") + 1)
    : withoutScheme;
  const hostPart = afterAuth.split("/")[0].split("?")[0];
  const hosts = hostPart.split(",").map((h) => {
    const trimmed = h.trim();
    return trimmed.includes(":") ? trimmed : `${trimmed}:27017`;
  });
  return { hosts };
}

function tcpProbe(host: string, port: number, timeoutMs = 4000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
    socket.connect(port, host);
  });
}

export async function checkCluster(uri: string): Promise<ClusterCheck> {
  let hosts: string[];
  try {
    hosts = parseMongoUri(uri).hosts;
  } catch {
    return { reachable: false, error: "Could not parse URI" };
  }
  const [host, portStr] = hosts[0].split(":");
  const reachable = await tcpProbe(host, Number(portStr));
  if (!reachable) return { reachable: false, error: `Cannot reach ${hosts[0]}` };

  // Best-effort version read via mongosh if present; failure is non-fatal.
  try {
    const { stdout } = await execFileAsync(
      "mongosh",
      [uri, "--quiet", "--eval", "db.version()"],
      { timeout: 8000 }
    );
    return { reachable: true, version: stdout.trim() };
  } catch {
    return { reachable: true };
  }
}
```

- [ ] **Step 8: Run cluster-check tests**

```bash
npx vitest run src/lib/__tests__/cluster-check.test.ts
```

Expected: all 4 `parseMongoUri` tests PASS.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: process manager and cluster connectivity/version check"
```

---

### Task 4: Poller + Migration/Metrics/Settings/Cluster API Routes

**Files:**
- Create: `src/lib/poller.ts`
- Create: `src/app/api/migrations/route.ts` (GET all, POST create)
- Create: `src/app/api/migrations/[id]/route.ts` (GET one, DELETE)
- Create: `src/app/api/migrations/[id]/start/route.ts`
- Create: `src/app/api/migrations/[id]/pause/route.ts`
- Create: `src/app/api/migrations/[id]/resume/route.ts`
- Create: `src/app/api/migrations/[id]/commit/route.ts`
- Create: `src/app/api/migrations/[id]/reverse/route.ts`
- Create: `src/app/api/migrations/[id]/progress/route.ts` (GET live progress passthrough)
- Create: `src/app/api/migrations/[id]/logs/route.ts`
- Create: `src/app/api/metrics/[migrationId]/route.ts`
- Create: `src/app/api/settings/route.ts`
- Create: `src/app/api/mongosync/version/route.ts`
- Create: `src/app/api/cluster-check/route.ts`
- Test: `src/lib/__tests__/poller.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–3
- Produces:
  - `startPoller(intervalMs?): void`, `stopPoller(): void`, `pollOnce(): Promise<void>`, `progressToMetric(migrationId, p): MetricInput`
  - REST API (see file list). Action routes verify state preconditions and surface mongosync errors:
    - `POST /api/migrations/[id]/commit` rejects with 409 unless live `progress.canCommit === true`.
    - `POST /api/migrations/[id]/reverse` rejects with 409 unless state is `COMMITTED` and the stored config had `reversible: true`.

- [ ] **Step 1: Write failing test for the progress→metric mapping**

This is the one piece of poller logic worth unit-testing in isolation (network and timers are not).

Create `src/lib/__tests__/poller.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { ProgressResponse } from "@/lib/process-manager";

async function load() {
  return await import("@/lib/poller");
}

const sample: ProgressResponse = {
  success: true,
  progress: {
    state: "RUNNING",
    canCommit: true,
    canWrite: false,
    lagTimeSeconds: 3,
    totalEventsApplied: 1000,
    estimatedSecondsToCEACatchup: 12,
    collectionCopy: { estimatedCopiedBytes: 5000, estimatedTotalBytes: 10000 },
    indexBuilding: { indexesBuilt: 2, totalIndexesToBuild: 8 },
    source: { pingLatencyMs: 15 },
    destination: { pingLatencyMs: 22 },
  },
};

describe("progressToMetric", () => {
  it("derives copyProgress from bytes and maps fields", async () => {
    const { progressToMetric } = await load();
    const m = progressToMetric("mig1", sample);
    expect(m.migrationId).toBe("mig1");
    expect(m.state).toBe("RUNNING");
    expect(m.copyProgress).toBe(50);
    expect(m.estimatedCopiedBytes).toBe(5000);
    expect(m.lagTimeSeconds).toBe(3);
    expect(m.totalEventsApplied).toBe(1000);
    expect(m.estimatedSecondsToCEACatchup).toBe(12);
    expect(m.indexesBuilt).toBe(2);
    expect(m.totalIndexesToBuild).toBe(8);
    expect(m.sourcePingMs).toBe(15);
    expect(m.destPingMs).toBe(22);
  });

  it("defaults copyProgress to 0 when total bytes is 0 or missing", async () => {
    const { progressToMetric } = await load();
    const m = progressToMetric("mig1", { success: true, progress: { state: "RUNNING", canCommit: false, canWrite: false } });
    expect(m.copyProgress).toBe(0);
    expect(m.indexesBuilt).toBe(0);
    expect(m.sourcePingMs).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/lib/__tests__/poller.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the poller**

Create `src/lib/poller.ts`:

```ts
import { getAllMigrations, updateMigration, insertMetric } from "./db";
import { fetchProgress, isProcessAlive } from "./process-manager";
import type { ProgressResponse } from "./process-manager";
import type { MetricInput, MongosyncState } from "./types";

let intervalId: ReturnType<typeof setInterval> | null = null;

// States where mongosync is actively reporting progress worth recording.
const ACTIVE_STATES = ["RUNNING", "COMMITTING", "REVERSING", "PAUSED"];

export function progressToMetric(migrationId: string, resp: ProgressResponse): MetricInput {
  const p = resp.progress;
  const copied = p?.collectionCopy?.estimatedCopiedBytes ?? 0;
  const total = p?.collectionCopy?.estimatedTotalBytes ?? 0;
  return {
    migrationId,
    state: p?.state ?? "RUNNING",
    copyProgress: total > 0 ? (copied / total) * 100 : 0,
    estimatedCopiedBytes: copied,
    estimatedTotalBytes: total,
    lagTimeSeconds: p?.lagTimeSeconds ?? null,
    totalEventsApplied: p?.totalEventsApplied ?? 0,
    estimatedSecondsToCEACatchup: p?.estimatedSecondsToCEACatchup ?? null,
    indexesBuilt: p?.indexBuilding?.indexesBuilt ?? 0,
    totalIndexesToBuild: p?.indexBuilding?.totalIndexesToBuild ?? 0,
    sourcePingMs: p?.source?.pingLatencyMs ?? null,
    destPingMs: p?.destination?.pingLatencyMs ?? null,
  };
}

export async function pollOnce(): Promise<void> {
  for (const m of getAllMigrations()) {
    // Reconcile a dead process.
    if (m.pid && !isProcessAlive(m.pid)) {
      updateMigration(m.id, { pid: null });
      continue;
    }
    if (!m.pid || !ACTIVE_STATES.includes(m.state)) continue;

    try {
      const resp = await fetchProgress(m.port);
      const liveState = resp.progress?.state as MongosyncState | undefined;
      if (liveState && liveState !== m.state) updateMigration(m.id, { state: liveState });
      insertMetric(progressToMetric(m.id, resp));
    } catch {
      // process may still be initializing — ignore this tick
    }
  }
}

export function startPoller(intervalMs = 5000): void {
  if (intervalId) return;
  intervalId = setInterval(pollOnce, intervalMs);
  void pollOnce();
}

export function stopPoller(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
```

- [ ] **Step 4: Run poller test to verify it passes**

```bash
npx vitest run src/lib/__tests__/poller.test.ts
```

Expected: both tests PASS.

- [ ] **Step 5: Implement migrations collection route (list + create+spawn+start)**

Create `src/app/api/migrations/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getAllMigrations, createMigration, getMigration, updateMigration } from "@/lib/db";
import { spawnMongosync, sendCommand } from "@/lib/process-manager";
import { buildStartBody } from "@/lib/config-generator";
import { startPoller } from "@/lib/poller";
import { initApp } from "@/lib/init";

export async function GET() {
  initApp();
  return NextResponse.json(getAllMigrations());
}

export async function POST(request: NextRequest) {
  initApp();
  const { name, sourceUri, destUri, config } = await request.json();

  const used = new Set(getAllMigrations().map((m) => m.port));
  let port = 27182;
  while (used.has(port)) port++;

  const migration = createMigration({ name, sourceUri, destUri, config: config ?? {}, port });

  try {
    spawnMongosync(migration);

    // Wait for the HTTP API to come up (up to 15s).
    let ready = false;
    for (let i = 0; i < 30; i++) {
      try {
        const res = await fetch(`http://localhost:${port}/api/v1/progress`);
        if (res.ok) { ready = true; break; }
      } catch { /* not ready */ }
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!ready) {
      return NextResponse.json({ error: "mongosync failed to start within 15s" }, { status: 500 });
    }

    await sendCommand(port, "start", buildStartBody(migration));
    updateMigration(migration.id, { state: "RUNNING" });
    startPoller();
    return NextResponse.json(getMigration(migration.id), { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
```

- [ ] **Step 6: Implement single-migration route (get + delete)**

Create `src/app/api/migrations/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getMigration, deleteMigration } from "@/lib/db";
import { killMongosync } from "@/lib/process-manager";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const migration = getMigration(id);
  if (!migration) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(migration);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const migration = getMigration(id);
  if (!migration) return NextResponse.json({ error: "Not found" }, { status: 404 });
  killMongosync(migration);
  deleteMigration(id);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 7: Implement start/pause/resume action routes**

Create `src/app/api/migrations/[id]/start/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getMigration, updateMigration } from "@/lib/db";
import { sendCommand } from "@/lib/process-manager";
import { buildStartBody } from "@/lib/config-generator";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const migration = getMigration(id);
  if (!migration) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    await sendCommand(migration.port, "start", buildStartBody(migration));
    updateMigration(id, { state: "RUNNING" });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
```

Create `src/app/api/migrations/[id]/pause/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getMigration, updateMigration } from "@/lib/db";
import { sendCommand } from "@/lib/process-manager";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const migration = getMigration(id);
  if (!migration) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    await sendCommand(migration.port, "pause");
    updateMigration(id, { state: "PAUSED" });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
```

Create `src/app/api/migrations/[id]/resume/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getMigration, updateMigration } from "@/lib/db";
import { sendCommand } from "@/lib/process-manager";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const migration = getMigration(id);
  if (!migration) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    await sendCommand(migration.port, "resume");
    updateMigration(id, { state: "RUNNING" });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
```

- [ ] **Step 8: Implement commit route with `canCommit` gating**

Create `src/app/api/migrations/[id]/commit/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getMigration, updateMigration } from "@/lib/db";
import { sendCommand, fetchProgress } from "@/lib/process-manager";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const migration = getMigration(id);
  if (!migration) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const progress = await fetchProgress(migration.port);
    if (!progress.progress?.canCommit) {
      return NextResponse.json(
        { error: "Cannot commit yet: canCommit is false. Wait for lag to reach ~0." },
        { status: 409 }
      );
    }
    await sendCommand(migration.port, "commit");
    updateMigration(id, { state: "COMMITTING" });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
```

- [ ] **Step 9: Implement reverse route with prerequisite gating**

Create `src/app/api/migrations/[id]/reverse/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getMigration, updateMigration } from "@/lib/db";
import { sendCommand } from "@/lib/process-manager";
import type { StartConfig } from "@/lib/types";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const migration = getMigration(id);
  if (!migration) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (migration.state !== "COMMITTED") {
    return NextResponse.json(
      { error: "Reverse is only available from the COMMITTED state." },
      { status: 409 }
    );
  }
  const cfg = JSON.parse(migration.config) as StartConfig;
  if (!cfg.reversible) {
    return NextResponse.json(
      { error: "This migration was not started with reversible: true." },
      { status: 409 }
    );
  }

  try {
    await sendCommand(migration.port, "reverse");
    updateMigration(id, { state: "REVERSING" });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
```

- [ ] **Step 10: Implement live progress passthrough route**

The detail page reads rich live fields (direction mapping, oplog window, verification, warnings) that we don't persist as metrics. This route proxies the current `/progress`.

Create `src/app/api/migrations/[id]/progress/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getMigration } from "@/lib/db";
import { fetchProgress } from "@/lib/process-manager";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const migration = getMigration(id);
  if (!migration) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const progress = await fetchProgress(migration.port);
    return NextResponse.json(progress);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 503 });
  }
}
```

- [ ] **Step 11: Implement metrics, logs, settings, version, cluster-check routes**

Create `src/app/api/metrics/[migrationId]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getMetrics } from "@/lib/db";

export async function GET(req: NextRequest, { params }: { params: Promise<{ migrationId: string }> }) {
  const { migrationId } = await params;
  const since = req.nextUrl.searchParams.get("since");
  return NextResponse.json(getMetrics(migrationId, since ? Number(since) : undefined));
}
```

Create `src/app/api/migrations/[id]/logs/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getMigration } from "@/lib/db";
import { getLogDir } from "@/lib/paths";
import fs from "fs";
import path from "path";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getMigration(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const lines = Number(req.nextUrl.searchParams.get("lines") || "200");
  const which = req.nextUrl.searchParams.get("stream") === "stderr" ? "stderr.log" : "stdout.log";
  const logFile = path.join(getLogDir(id), which);
  if (!fs.existsSync(logFile)) return NextResponse.json({ lines: [] });

  const all = fs.readFileSync(logFile, "utf-8").split("\n").filter(Boolean);
  return NextResponse.json({ lines: all.slice(-lines) });
}
```

Create `src/app/api/settings/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getSetting, setSetting } from "@/lib/db";

const KEYS = [
  "mongosyncPath",
  "pollInterval",
  "basePort",
  "defaultLoadLevel",
  "defaultVerbosity",
  "defaultVerification",
  "defaultDisableTelemetry",
];

export async function GET() {
  const out: Record<string, string> = {};
  for (const k of KEYS) out[k] = getSetting(k) ?? "";
  return NextResponse.json(out);
}

export async function PUT(request: NextRequest) {
  const body = await request.json();
  for (const [key, value] of Object.entries(body)) {
    if (KEYS.includes(key) && typeof value === "string") setSetting(key, value);
  }
  return NextResponse.json({ ok: true });
}
```

Create `src/app/api/mongosync/version/route.ts`:

```ts
import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getSetting } from "@/lib/db";

const execFileAsync = promisify(execFile);

export async function GET() {
  const bin = getSetting("mongosyncPath") || "mongosync";
  try {
    const { stdout } = await execFileAsync(bin, ["--version"], { timeout: 5000 });
    return NextResponse.json({ version: stdout.trim() });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
```

Create `src/app/api/cluster-check/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { checkCluster } from "@/lib/cluster-check";

export async function POST(request: NextRequest) {
  const { uri } = await request.json();
  if (typeof uri !== "string" || !uri) {
    return NextResponse.json({ reachable: false, error: "uri required" }, { status: 400 });
  }
  return NextResponse.json(await checkCluster(uri));
}
```

- [ ] **Step 12: Create init module stub (filled in Task 9)**

So the routes above compile, create `src/lib/init.ts` now with a no-throw stub that starts the poller; Task 9 expands it.

```ts
import { startPoller } from "./poller";

let initialized = false;

export function initApp(): void {
  if (initialized) return;
  initialized = true;
  startPoller();
}
```

- [ ] **Step 13: Verify build + tests**

```bash
npm run build 2>&1 | tail -20
npm run test
```

Expected: build succeeds; all unit tests pass.

- [ ] **Step 14: Commit**

```bash
git add -A
git commit -m "feat: poller and full migration/metrics/settings/cluster API routes with commit+reverse gating"
```

---

### Task 5: Dashboard — State Badge, Action Buttons, Migration Cards

**Files:**
- Create: `src/lib/state-machine.ts`
- Create: `src/components/state-badge.tsx`
- Create: `src/components/action-buttons.tsx`
- Create: `src/components/migration-card.tsx`
- Modify: `src/app/page.tsx`
- Test: `src/lib/__tests__/state-machine.test.ts`

**Interfaces:**
- Consumes: `MongosyncState`, `Migration` (Task 1); migration action + delete routes (Task 4)
- Produces:
  - `state-machine.ts`: `availableActions(state: MongosyncState): ActionKind[]` where `ActionKind = "start" | "pause" | "resume" | "commit" | "reverse" | "delete"`; plus `STATE_COLORS: Record<MongosyncState, string>`
  - `StateBadge`, `ActionButtons`, `MigrationCard` components
  - Dashboard page wired to `GET /api/migrations` with 5s refresh

- [ ] **Step 1: Write failing test for the state machine**

Create `src/lib/__tests__/state-machine.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { availableActions } from "@/lib/state-machine";

describe("availableActions", () => {
  it("IDLE allows start + delete", () => {
    expect(availableActions("IDLE")).toEqual(["start", "delete"]);
  });
  it("RUNNING allows pause + commit + delete", () => {
    expect(availableActions("RUNNING")).toEqual(["pause", "commit", "delete"]);
  });
  it("PAUSED allows resume + delete", () => {
    expect(availableActions("PAUSED")).toEqual(["resume", "delete"]);
  });
  it("COMMITTED allows reverse + delete", () => {
    expect(availableActions("COMMITTED")).toEqual(["reverse", "delete"]);
  });
  it("COMMITTING and REVERSING are transient (delete only)", () => {
    expect(availableActions("COMMITTING")).toEqual(["delete"]);
    expect(availableActions("REVERSING")).toEqual(["delete"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/lib/__tests__/state-machine.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the state machine**

Create `src/lib/state-machine.ts`:

```ts
import type { MongosyncState } from "./types";

export type ActionKind = "start" | "pause" | "resume" | "commit" | "reverse" | "delete";

const ACTIONS: Record<MongosyncState, ActionKind[]> = {
  IDLE: ["start", "delete"],
  RUNNING: ["pause", "commit", "delete"],
  PAUSED: ["resume", "delete"],
  COMMITTING: ["delete"],
  COMMITTED: ["reverse", "delete"],
  REVERSING: ["delete"],
};

export function availableActions(state: MongosyncState): ActionKind[] {
  return ACTIONS[state] ?? ["delete"];
}

export const STATE_COLORS: Record<MongosyncState, string> = {
  IDLE: "bg-gray-100 text-gray-700 border-gray-300",
  RUNNING: "bg-blue-100 text-blue-700 border-blue-300",
  PAUSED: "bg-yellow-100 text-yellow-700 border-yellow-300",
  COMMITTING: "bg-purple-100 text-purple-700 border-purple-300",
  COMMITTED: "bg-green-100 text-green-700 border-green-300",
  REVERSING: "bg-orange-100 text-orange-700 border-orange-300",
};
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/lib/__tests__/state-machine.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Create StateBadge**

Create `src/components/state-badge.tsx`:

```tsx
"use client";

import { Badge } from "@/components/ui/badge";
import { STATE_COLORS } from "@/lib/state-machine";
import type { MongosyncState } from "@/lib/types";

export function StateBadge({ state }: { state: MongosyncState }) {
  return (
    <Badge variant="outline" className={STATE_COLORS[state] || ""}>
      {state}
    </Badge>
  );
}
```

- [ ] **Step 6: Create ActionButtons**

`commit` and `reverse` open a confirmation dialog (handled by the parent via `onConfirm`); `delete` confirms inline. Errors surface via the toast hook.

Create `src/components/action-buttons.tsx`:

```tsx
"use client";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { availableActions, type ActionKind } from "@/lib/state-machine";
import type { Migration } from "@/lib/types";
import { useRouter } from "next/navigation";
import { useState } from "react";

const LABELS: Record<ActionKind, string> = {
  start: "Start",
  pause: "Pause",
  resume: "Resume",
  commit: "Commit",
  reverse: "Reverse",
  delete: "Delete",
};

export function ActionButtons({
  migration,
  onAction,
  onConfirmCommit,
}: {
  migration: Migration;
  onAction?: () => void;
  onConfirmCommit?: () => void; // detail page wires this to the pre-commit checklist dialog
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [loading, setLoading] = useState<ActionKind | null>(null);

  const run = async (action: ActionKind) => {
    setLoading(action);
    try {
      if (action === "delete") {
        if (!confirm(`Delete migration "${migration.name}"? This kills its mongosync process.`)) return;
        const res = await fetch(`/api/migrations/${migration.id}`, { method: "DELETE" });
        if (!res.ok) throw new Error((await res.json()).error || "Delete failed");
      } else {
        const res = await fetch(`/api/migrations/${migration.id}/${action}`, { method: "POST" });
        if (!res.ok) throw new Error((await res.json()).error || `${action} failed`);
      }
      onAction?.();
      router.refresh();
    } catch (err) {
      toast({ variant: "destructive", title: "Action failed", description: (err as Error).message });
    } finally {
      setLoading(null);
    }
  };

  const onClick = (action: ActionKind) => {
    if (action === "commit" && onConfirmCommit) return onConfirmCommit();
    if ((action === "commit" || action === "reverse") && !onConfirmCommit) {
      if (!confirm(`${LABELS[action]} this migration? This step is hard to undo.`)) return;
    }
    void run(action);
  };

  return (
    <div className="flex gap-2">
      {availableActions(migration.state).map((action) => (
        <Button
          key={action}
          size="sm"
          variant={action === "delete" ? "destructive" : action === "start" || action === "resume" ? "default" : "outline"}
          disabled={loading !== null}
          onClick={() => onClick(action)}
        >
          {loading === action ? "..." : LABELS[action]}
        </Button>
      ))}
    </div>
  );
}
```

- [ ] **Step 7: Create MigrationCard**

Create `src/components/migration-card.tsx`:

```tsx
"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StateBadge } from "./state-badge";
import { ActionButtons } from "./action-buttons";
import type { Migration } from "@/lib/types";
import Link from "next/link";

export function MigrationCard({ migration, onAction }: { migration: Migration; onAction?: () => void }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <Link href={`/migrations/${migration.id}`}>
            <CardTitle className="text-base hover:underline cursor-pointer">{migration.name}</CardTitle>
          </Link>
          <StateBadge state={migration.state} />
        </div>
        <p className="text-sm text-muted-foreground truncate">
          {migration.sourceUri} → {migration.destUri}
        </p>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>Port: {migration.port}</span>
            {migration.pid && <span>PID: {migration.pid}</span>}
          </div>
          <ActionButtons migration={migration} onAction={onAction} />
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 8: Build the dashboard page**

Replace `src/app/page.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { MigrationCard } from "@/components/migration-card";
import Link from "next/link";
import type { Migration } from "@/lib/types";

export default function DashboardPage() {
  const [migrations, setMigrations] = useState<Migration[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchMigrations = async () => {
    try {
      setMigrations(await (await fetch("/api/migrations")).json());
    } catch { /* ignore */ } finally { setLoading(false); }
  };

  useEffect(() => {
    fetchMigrations();
    const t = setInterval(fetchMigrations, 5000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Migrations</h1>
        <Link href="/migrations/new"><Button>New Migration</Button></Link>
      </div>
      {loading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : migrations.length === 0 ? (
        <p className="text-muted-foreground">No migrations yet. Create one to get started.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {migrations.map((m) => (
            <MigrationCard key={m.id} migration={m} onAction={fetchMigrations} />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 9: Verify dashboard renders**

```bash
npm run dev &
sleep 3
curl -s http://localhost:3000 | grep -o "Migrations" | head -1
kill %1
```

Expected: prints `Migrations`.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: dashboard with state-aware action buttons and migration cards"
```

---

### Task 6: New Migration Form (full options + connection test)

**Files:**
- Create: `src/lib/schemas.ts`
- Create: `src/components/cluster-uri-field.tsx`
- Create: `src/components/namespace-filter-fields.tsx`
- Create: `src/components/migration-form.tsx`
- Create: `src/app/migrations/new/page.tsx`
- Test: `src/lib/__tests__/schemas.test.ts`

**Interfaces:**
- Consumes: `POST /api/migrations`, `POST /api/cluster-check` (Task 4); `StartConfig`, `NamespaceFilter` types (Task 1)
- Produces:
  - `schemas.ts`: `migrationFormSchema` (zod), `MigrationFormValues` type, `formValuesToConfig(values): StartConfig`
  - `ClusterUriField` (input + Test button calling `/api/cluster-check`)
  - `NamespaceFilterFields` (repeatable include/exclude rows with database/regex/collections)
  - `MigrationForm` + `/migrations/new` page

- [ ] **Step 1: Write failing tests for schema → config mapping**

Create `src/lib/__tests__/schemas.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { migrationFormSchema, formValuesToConfig } from "@/lib/schemas";

const base = {
  name: "m",
  sourceUri: "mongodb://a",
  destUri: "mongodb://b",
  reversible: false,
  buildIndexes: "afterDataCopy" as const,
  detectRandomId: true,
  preExistingDestinationData: false,
  verificationEnabled: true,
  loadLevel: 3,
  verbosity: "INFO" as const,
  includeNamespaces: [],
  excludeNamespaces: [],
  shardingEntries: [],
};

describe("migrationFormSchema", () => {
  it("rejects a non-mongodb source URI", () => {
    const r = migrationFormSchema.safeParse({ ...base, sourceUri: "http://x" });
    expect(r.success).toBe(false);
  });
  it("accepts a valid minimal form", () => {
    expect(migrationFormSchema.safeParse(base).success).toBe(true);
  });
});

describe("formValuesToConfig", () => {
  it("only includes namespaces when non-empty and trims regex", () => {
    const cfg = formValuesToConfig({
      ...base,
      includeNamespaces: [{ database: "sales", collections: "EMEA, APAC", databaseRegex: "", collectionsRegex: "" }],
      excludeNamespaces: [{ database: "", collections: "", databaseRegex: "^tmp_", collectionsRegex: "" }],
    });
    expect(cfg.includeNamespaces).toEqual([{ database: "sales", collections: ["EMEA", "APAC"] }]);
    expect(cfg.excludeNamespaces).toEqual([{ databaseRegex: { pattern: "^tmp_" } }]);
  });

  it("omits loadLevel when at default 3 but keeps non-default", () => {
    expect(formValuesToConfig(base).loadLevel).toBeUndefined();
    expect(formValuesToConfig({ ...base, loadLevel: 4 }).loadLevel).toBe(4);
  });

  it("maps verification toggle to verificationEnabled", () => {
    expect(formValuesToConfig(base).verificationEnabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/lib/__tests__/schemas.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement schemas + mapping**

Create `src/lib/schemas.ts`:

```ts
import { z } from "zod";
import type { NamespaceFilter, StartConfig } from "./types";

export const namespaceRowSchema = z.object({
  database: z.string().default(""),
  databaseRegex: z.string().default(""),
  collections: z.string().default(""), // comma-separated in the UI
  collectionsRegex: z.string().default(""),
});

export const shardingEntrySchema = z.object({
  database: z.string().min(1),
  collection: z.string().min(1),
  shardKey: z.string().min(1), // "field:1, other:hashed" parsed on submit
});

export const migrationFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  sourceUri: z.string().startsWith("mongodb", "Must be a mongodb:// or mongodb+srv:// URI"),
  destUri: z.string().startsWith("mongodb", "Must be a mongodb:// or mongodb+srv:// URI"),
  reversible: z.boolean().default(false),
  buildIndexes: z
    .enum(["afterDataCopy", "beforeDataCopy", "excludeHashed", "excludeHashedAfterCopy", "never"])
    .default("afterDataCopy"),
  detectRandomId: z.boolean().default(true),
  preExistingDestinationData: z.boolean().default(false),
  verificationEnabled: z.boolean().default(true),
  loadLevel: z.number().min(1).max(4).default(3),
  verbosity: z.enum(["TRACE", "DEBUG", "INFO", "WARN", "ERROR", "FATAL", "PANIC"]).default("INFO"),
  includeNamespaces: z.array(namespaceRowSchema).default([]),
  excludeNamespaces: z.array(namespaceRowSchema).default([]),
  shardingEntries: z.array(shardingEntrySchema).default([]),
});

export type MigrationFormValues = z.infer<typeof migrationFormSchema>;
type NamespaceRow = z.infer<typeof namespaceRowSchema>;

function rowToFilter(row: NamespaceRow): NamespaceFilter | null {
  const f: NamespaceFilter = {};
  if (row.database.trim()) f.database = row.database.trim();
  else if (row.databaseRegex.trim()) f.databaseRegex = { pattern: row.databaseRegex.trim() };
  else return null; // a row needs at least a database or databaseRegex
  const cols = row.collections.split(",").map((c) => c.trim()).filter(Boolean);
  if (cols.length) f.collections = cols;
  if (row.collectionsRegex.trim()) f.collectionsRegex = { pattern: row.collectionsRegex.trim() };
  return f;
}

export function formValuesToConfig(values: MigrationFormValues): StartConfig {
  const cfg: StartConfig = {
    buildIndexes: values.buildIndexes,
    reversible: values.reversible,
    detectRandomId: values.detectRandomId,
    preExistingDestinationData: values.preExistingDestinationData,
    verificationEnabled: values.verificationEnabled,
    verbosity: values.verbosity,
  };
  if (values.loadLevel !== 3) cfg.loadLevel = values.loadLevel;

  const inc = values.includeNamespaces.map(rowToFilter).filter((x): x is NamespaceFilter => x !== null);
  const exc = values.excludeNamespaces.map(rowToFilter).filter((x): x is NamespaceFilter => x !== null);
  if (inc.length) cfg.includeNamespaces = inc;
  if (exc.length) cfg.excludeNamespaces = exc;

  if (values.shardingEntries.length) {
    cfg.sharding = {
      shardingEntries: values.shardingEntries.map((e) => ({
        database: e.database,
        collection: e.collection,
        shardCollection: {
          key: e.shardKey.split(",").map((part) => {
            const [field, dir] = part.split(":").map((s) => s.trim());
            return { [field]: dir === "hashed" ? ("hashed" as const) : (1 as const) };
          }),
        },
      })),
    };
  }
  return cfg;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/lib/__tests__/schemas.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Create ClusterUriField (input + connectivity test)**

Create `src/components/cluster-uri-field.tsx`:

```tsx
"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useState } from "react";

export function ClusterUriField({
  id,
  label,
  value,
  error,
  register,
}: {
  id: string;
  label: string;
  value: string;
  error?: string;
  register: React.ComponentProps<typeof Input>;
}) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      const res = await fetch("/api/cluster-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uri: value }),
      });
      const data = await res.json();
      setResult(
        data.reachable
          ? { ok: true, msg: data.version ? `Reachable — MongoDB ${data.version}` : "Reachable" }
          : { ok: false, msg: data.error || "Unreachable" }
      );
    } catch (e) {
      setResult({ ok: false, msg: (e as Error).message });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <Input id={id} placeholder="mongodb://..." {...register} />
        <Button type="button" variant="outline" disabled={testing || !value} onClick={test}>
          {testing ? "Testing..." : "Test"}
        </Button>
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
      {result && (
        <p className={`text-sm ${result.ok ? "text-green-600" : "text-red-500"}`}>{result.msg}</p>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Create NamespaceFilterFields**

Create `src/components/namespace-filter-fields.tsx`:

```tsx
"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useFieldArray, type Control, type UseFormRegister } from "react-hook-form";
import type { MigrationFormValues } from "@/lib/schemas";

export function NamespaceFilterFields({
  control,
  register,
  name,
  label,
}: {
  control: Control<MigrationFormValues>;
  register: UseFormRegister<MigrationFormValues>;
  name: "includeNamespaces" | "excludeNamespaces";
  label: string;
}) {
  const fa = useFieldArray({ control, name });
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {fa.fields.map((field, i) => (
        <div key={field.id} className="grid grid-cols-[1fr_1fr_auto] gap-2">
          <Input placeholder="database" {...register(`${name}.${i}.database`)} />
          <Input placeholder="collections (comma-separated)" {...register(`${name}.${i}.collections`)} />
          <Button type="button" variant="outline" size="sm" onClick={() => fa.remove(i)}>X</Button>
          <Input placeholder="databaseRegex (optional)" {...register(`${name}.${i}.databaseRegex`)} />
          <Input placeholder="collectionsRegex (optional)" {...register(`${name}.${i}.collectionsRegex`)} />
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => fa.append({ database: "", collections: "", databaseRegex: "", collectionsRegex: "" })}
      >
        Add {label} row
      </Button>
    </div>
  );
}
```

- [ ] **Step 7: Create the MigrationForm**

Create `src/components/migration-form.tsx`:

```tsx
"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { migrationFormSchema, formValuesToConfig, type MigrationFormValues } from "@/lib/schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ClusterUriField } from "./cluster-uri-field";
import { NamespaceFilterFields } from "./namespace-filter-fields";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function MigrationForm() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<MigrationFormValues>({
    resolver: zodResolver(migrationFormSchema),
    defaultValues: {
      name: "", sourceUri: "", destUri: "",
      reversible: false, buildIndexes: "afterDataCopy", detectRandomId: true,
      preExistingDestinationData: false, verificationEnabled: true,
      loadLevel: 3, verbosity: "INFO",
      includeNamespaces: [], excludeNamespaces: [], shardingEntries: [],
    },
  });

  const reversible = form.watch("reversible");
  const hasFilters =
    form.watch("includeNamespaces").length > 0 || form.watch("excludeNamespaces").length > 0;

  const onSubmit = async (values: MigrationFormValues) => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/migrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: values.name,
          sourceUri: values.sourceUri,
          destUri: values.destUri,
          config: formValuesToConfig(values),
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to create migration");
      router.push("/");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 max-w-2xl">
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

      <div className="space-y-2">
        <Label htmlFor="name">Migration Name</Label>
        <Input id="name" {...form.register("name")} placeholder="My Migration" />
        {form.formState.errors.name && (
          <p className="text-sm text-red-500">{form.formState.errors.name.message}</p>
        )}
      </div>

      <ClusterUriField
        id="sourceUri" label="Source Cluster URI" value={form.watch("sourceUri")}
        error={form.formState.errors.sourceUri?.message} register={form.register("sourceUri")}
      />
      <ClusterUriField
        id="destUri" label="Destination Cluster URI" value={form.watch("destUri")}
        error={form.formState.errors.destUri?.message} register={form.register("destUri")}
      />

      <div className="space-y-4 rounded-md border p-4">
        <h3 className="font-medium">Sync Options</h3>
        <div className="flex items-center justify-between">
          <Label htmlFor="reversible">Reversible</Label>
          <Switch id="reversible" checked={reversible}
            onCheckedChange={(v) => form.setValue("reversible", v)} />
        </div>
        {reversible && hasFilters && (
          <Alert variant="destructive">
            <AlertDescription>
              Reverse sync is incompatible with namespace filtering. Remove filters or disable reversible.
            </AlertDescription>
          </Alert>
        )}
        <div className="flex items-center justify-between">
          <Label htmlFor="detectRandomId">Detect Random _id</Label>
          <Switch id="detectRandomId" checked={form.watch("detectRandomId")}
            onCheckedChange={(v) => form.setValue("detectRandomId", v)} />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="preExisting">Allow Pre-existing Destination Data</Label>
          <Switch id="preExisting" checked={form.watch("preExistingDestinationData")}
            onCheckedChange={(v) => form.setValue("preExistingDestinationData", v)} />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="buildIndexes">Build Indexes</Label>
          <select id="buildIndexes" className="rounded border px-2 py-1 text-sm" {...form.register("buildIndexes")}>
            <option value="afterDataCopy">afterDataCopy</option>
            <option value="beforeDataCopy">beforeDataCopy</option>
            <option value="excludeHashed">excludeHashed</option>
            <option value="excludeHashedAfterCopy">excludeHashedAfterCopy</option>
            <option value="never">never</option>
          </select>
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="verification">Enable Embedded Verification</Label>
          <Switch id="verification" checked={form.watch("verificationEnabled")}
            onCheckedChange={(v) => form.setValue("verificationEnabled", v)} />
        </div>
      </div>

      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" type="button" className="w-full justify-start">+ Namespace Filtering</Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-4 pt-2">
          <NamespaceFilterFields control={form.control} register={form.register}
            name="includeNamespaces" label="Include" />
          <NamespaceFilterFields control={form.control} register={form.register}
            name="excludeNamespaces" label="Exclude" />
        </CollapsibleContent>
      </Collapsible>

      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" type="button" className="w-full justify-start">+ Advanced (performance & logging)</Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label>Load Level: {form.watch("loadLevel")} (1 = gentlest, 4 = fastest)</Label>
            <Slider min={1} max={4} step={1} value={[form.watch("loadLevel")]}
              onValueChange={([v]) => form.setValue("loadLevel", v)} />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="verbosity">Log Verbosity</Label>
            <select id="verbosity" className="rounded border px-2 py-1 text-sm" {...form.register("verbosity")}>
              {["TRACE", "DEBUG", "INFO", "WARN", "ERROR", "FATAL", "PANIC"].map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>
        </CollapsibleContent>
      </Collapsible>

      <Button type="submit" disabled={submitting || (reversible && hasFilters)} className="w-full">
        {submitting ? "Creating..." : "Create & Start Migration"}
      </Button>
    </form>
  );
}
```

- [ ] **Step 8: Create the new-migration page**

Create `src/app/migrations/new/page.tsx`:

```tsx
import { MigrationForm } from "@/components/migration-form";

export default function NewMigrationPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">New Migration</h1>
      <MigrationForm />
    </div>
  );
}
```

- [ ] **Step 9: Verify build + form page render**

```bash
npm run build 2>&1 | tail -10
npm run dev &
sleep 3
curl -s http://localhost:3000/migrations/new | grep -o "New Migration" | head -1
kill %1
```

Expected: build succeeds; prints `New Migration`.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: new migration form with full start options, namespace filters, and connection test"
```

---

### Task 7: Migration Detail — Live Progress Panels, Charts, Logs

**Files:**
- Create: `src/lib/format.ts`
- Create: `src/components/progress-panel.tsx`
- Create: `src/components/verification-panel.tsx`
- Create: `src/components/metrics-charts.tsx`
- Create: `src/components/logs-panel.tsx`
- Create: `src/app/migrations/[id]/page.tsx`
- Test: `src/lib/__tests__/format.test.ts`

**Interfaces:**
- Consumes: `GET /api/migrations/[id]`, `GET /api/migrations/[id]/progress`, `GET /api/metrics/[migrationId]`, `GET /api/migrations/[id]/logs` (Task 4); `ProgressResponse` type (Task 3); `StateBadge`, `ActionButtons` (Task 5)
- Produces:
  - `format.ts`: `formatBytes(n: number): string`, `formatDuration(seconds: number): string`
  - `ProgressPanel` (stat cards + copy/index progress bars + oplog/ping/direction), `VerificationPanel`, `MetricsCharts`, `LogsPanel`
  - `/migrations/[id]` detail page wiring everything with 5s refresh, including the pre-commit checklist dialog (Task 8 supplies the dialog component; this task renders the page and passes `onConfirmCommit`)

- [ ] **Step 1: Write failing tests for formatters**

Create `src/lib/__tests__/format.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { formatBytes, formatDuration } from "@/lib/format";

describe("formatBytes", () => {
  it("formats zero and units", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1048576)).toBe("1.0 MB");
  });
});

describe("formatDuration", () => {
  it("formats seconds, minutes, hours", () => {
    expect(formatDuration(45)).toBe("45s");
    expect(formatDuration(90)).toBe("1m 30s");
    expect(formatDuration(3661)).toBe("1h 1m");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/lib/__tests__/format.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement format helpers**

Create `src/lib/format.ts`:

```ts
export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/lib/__tests__/format.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Create ProgressPanel**

Renders live `/progress` fields: copy progress bar, index-build progress, CEA catchup, lag, oplog window, ping latencies, direction mapping, and any warnings.

Create `src/components/progress-panel.tsx`:

```tsx
"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { formatBytes, formatDuration } from "@/lib/format";
import type { ProgressResponse } from "@/lib/process-manager";

function Stat({ title, value, sub }: { title: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

export function ProgressPanel({ data }: { data: ProgressResponse | null }) {
  const p = data?.progress;
  if (!p) return <p className="text-sm text-muted-foreground">Live progress unavailable (process not reporting).</p>;

  const copied = p.collectionCopy?.estimatedCopiedBytes ?? 0;
  const total = p.collectionCopy?.estimatedTotalBytes ?? 0;
  const copyPct = total > 0 ? (copied / total) * 100 : 0;
  const idxBuilt = p.indexBuilding?.indexesBuilt ?? 0;
  const idxTotal = p.indexBuilding?.totalIndexesToBuild ?? 0;
  const idxPct = idxTotal > 0 ? (idxBuilt / idxTotal) * 100 : 0;

  return (
    <div className="space-y-4">
      {(p.warnings ?? []).map((w, i) => (
        <Alert key={i} variant="destructive"><AlertDescription>{w}</AlertDescription></Alert>
      ))}

      <div className="grid gap-4 md:grid-cols-4">
        <Stat title="Phase" value={p.info || p.state} />
        <Stat title="Lag Time" value={p.lagTimeSeconds != null ? `${p.lagTimeSeconds}s` : "—"} />
        <Stat title="Events Applied" value={(p.totalEventsApplied ?? 0).toLocaleString()} />
        <Stat
          title="CEA Catchup"
          value={p.estimatedSecondsToCEACatchup != null ? formatDuration(p.estimatedSecondsToCEACatchup) : "—"}
        />
        <Stat title="Oplog Window" value={p.estimatedOplogTimeRemaining || "—"} />
        <Stat title="Source Ping" value={p.source?.pingLatencyMs != null ? `${p.source.pingLatencyMs} ms` : "—"} />
        <Stat title="Dest Ping" value={p.destination?.pingLatencyMs != null ? `${p.destination.pingLatencyMs} ms` : "—"} />
        <Stat title="Can Commit" value={p.canCommit ? "Yes" : "No"} />
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Collection Copy</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Progress value={copyPct} />
          <p className="text-xs text-muted-foreground">
            {formatBytes(copied)} of {formatBytes(total)} ({copyPct.toFixed(1)}%)
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Index Building</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Progress value={idxPct} />
          <p className="text-xs text-muted-foreground">{idxBuilt} of {idxTotal} indexes built</p>
        </CardContent>
      </Card>

      {p.directionMapping && (
        <p className="text-xs text-muted-foreground">
          Direction: {p.directionMapping.Source} → {p.directionMapping.Destination}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Create VerificationPanel**

Create `src/components/verification-panel.tsx`:

```tsx
"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { VerificationSide } from "@/lib/process-manager";

function Side({ title, side }: { title: string; side?: VerificationSide }) {
  if (!side) return null;
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
      <CardContent className="space-y-1 text-xs text-muted-foreground">
        <div>Phase: {side.phase ?? "—"}</div>
        <div>Collections: {side.scannedCollectionCount ?? 0} / {side.totalCollectionCount ?? 0}</div>
        <div>Docs hashed: {(side.hashedDocumentCount ?? 0).toLocaleString()} / {(side.estimatedDocumentCount ?? 0).toLocaleString()}</div>
        <div>Lag: {side.lagTimeSeconds != null ? `${side.lagTimeSeconds}s` : "—"}</div>
      </CardContent>
    </Card>
  );
}

export function VerificationPanel({
  verification,
}: {
  verification?: { source?: VerificationSide; destination?: VerificationSide };
}) {
  if (!verification || (!verification.source && !verification.destination)) return null;
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">Embedded Verification</h3>
      <div className="grid gap-4 md:grid-cols-2">
        <Side title="Source" side={verification.source} />
        <Side title="Destination" side={verification.destination} />
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Create MetricsCharts (historical, from SQLite)**

Create `src/components/metrics-charts.tsx`:

```tsx
"use client";

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import type { Metric } from "@/lib/types";

const fmtTime = (ts: number) => new Date(ts).toLocaleTimeString();

function Chart({ data, dataKey, label, color, unit }: {
  data: Metric[]; dataKey: keyof Metric; label: string; color: string; unit?: string;
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">{label}</h3>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="timestamp" tickFormatter={fmtTime} tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} unit={unit} />
            <Tooltip labelFormatter={fmtTime} />
            <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function MetricsCharts({ metrics }: { metrics: Metric[] }) {
  if (metrics.length === 0) return <p className="text-sm text-muted-foreground">No metrics data yet.</p>;
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Chart data={metrics} dataKey="copyProgress" label="Copy Progress %" color="#2563eb" unit="%" />
      <Chart data={metrics} dataKey="lagTimeSeconds" label="Lag Time" color="#dc2626" unit="s" />
      <Chart data={metrics} dataKey="totalEventsApplied" label="Events Applied" color="#16a34a" />
      <Chart data={metrics} dataKey="estimatedCopiedBytes" label="Bytes Copied" color="#9333ea" />
    </div>
  );
}
```

- [ ] **Step 8: Create LogsPanel (stdout/stderr toggle + download)**

Create `src/components/logs-panel.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

export function LogsPanel({ migrationId }: { migrationId: string }) {
  const [lines, setLines] = useState<string[]>([]);
  const [stream, setStream] = useState<"stdout" | "stderr">("stdout");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        const res = await fetch(`/api/migrations/${migrationId}/logs?lines=300&stream=${stream}`);
        setLines((await res.json()).lines || []);
      } catch { /* ignore */ }
    };
    fetchLogs();
    const t = setInterval(fetchLogs, 5000);
    return () => clearInterval(t);
  }, [migrationId, stream]);

  useEffect(() => {
    if (containerRef.current) containerRef.current.scrollTop = containerRef.current.scrollHeight;
  }, [lines]);

  const download = () => {
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${migrationId}-${stream}.log`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Logs</h3>
        <div className="flex gap-2">
          <Button size="sm" variant={stream === "stdout" ? "default" : "outline"} onClick={() => setStream("stdout")}>stdout</Button>
          <Button size="sm" variant={stream === "stderr" ? "default" : "outline"} onClick={() => setStream("stderr")}>stderr</Button>
          <Button size="sm" variant="outline" onClick={download}>Download</Button>
        </div>
      </div>
      <div ref={containerRef} className="h-64 overflow-auto rounded-md border bg-black p-3 font-mono text-xs text-green-400">
        {lines.length === 0 ? (
          <p className="text-gray-500">No logs available.</p>
        ) : (
          lines.map((line, i) => <div key={i} className="whitespace-pre-wrap">{line}</div>)
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 9: Create the detail page**

Note: this page imports `PreCommitDialog` from Task 8. Implement that component first if executing strictly in order, or stub it. The page passes `onConfirmCommit` to `ActionButtons` to open the dialog.

Create `src/app/migrations/[id]/page.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { StateBadge } from "@/components/state-badge";
import { ActionButtons } from "@/components/action-buttons";
import { ProgressPanel } from "@/components/progress-panel";
import { VerificationPanel } from "@/components/verification-panel";
import { MetricsCharts } from "@/components/metrics-charts";
import { LogsPanel } from "@/components/logs-panel";
import { PreCommitDialog } from "@/components/pre-commit-dialog";
import type { Migration, Metric } from "@/lib/types";
import type { ProgressResponse } from "@/lib/process-manager";

export default function MigrationDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [migration, setMigration] = useState<Migration | null>(null);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [progress, setProgress] = useState<ProgressResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [commitOpen, setCommitOpen] = useState(false);

  const fetchData = async () => {
    try {
      const [migRes, metRes, progRes] = await Promise.all([
        fetch(`/api/migrations/${params.id}`),
        fetch(`/api/metrics/${params.id}`),
        fetch(`/api/migrations/${params.id}/progress`),
      ]);
      if (!migRes.ok) { router.push("/"); return; }
      setMigration(await migRes.json());
      setMetrics(await metRes.json());
      setProgress(progRes.ok ? await progRes.json() : null);
    } catch { /* ignore */ } finally { setLoading(false); }
  };

  useEffect(() => {
    fetchData();
    const t = setInterval(fetchData, 5000);
    return () => clearInterval(t);
  }, [params.id]);

  if (loading) return <p className="text-muted-foreground">Loading...</p>;
  if (!migration) return <p className="text-muted-foreground">Migration not found.</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{migration.name}</h1>
            <StateBadge state={migration.state} />
          </div>
          <p className="text-sm text-muted-foreground">{migration.sourceUri} → {migration.destUri}</p>
        </div>
        <ActionButtons migration={migration} onAction={fetchData} onConfirmCommit={() => setCommitOpen(true)} />
      </div>

      <ProgressPanel data={progress} />
      <VerificationPanel verification={progress?.progress?.verification} />
      <MetricsCharts metrics={metrics} />
      <LogsPanel migrationId={migration.id} />

      <PreCommitDialog
        open={commitOpen}
        onOpenChange={setCommitOpen}
        migrationId={migration.id}
        progress={progress}
        onCommitted={fetchData}
      />
    </div>
  );
}
```

- [ ] **Step 10: Verify build**

```bash
npm run build 2>&1 | tail -10
```

Expected: build fails only on the missing `PreCommitDialog` import — that is implemented in Task 8. If executing tasks strictly independently, temporarily comment out the dialog usage, build, then restore. Otherwise proceed to Task 8 and build there.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: migration detail page with live progress, verification, charts, and logs"
```

---

### Task 8: Pre-Commit Checklist Dialog + Settings Page

**Files:**
- Create: `src/components/pre-commit-dialog.tsx`
- Create: `src/app/settings/page.tsx`

**Interfaces:**
- Consumes: `POST /api/migrations/[id]/commit` (Task 4), `ProgressResponse` (Task 3); `GET/PUT /api/settings`, `GET /api/mongosync/version` (Task 4)
- Produces:
  - `PreCommitDialog` — shows the live readiness checklist (state RUNNING, `canCommit`, lag near 0) and a reminder to stop source writes; commit button disabled until ready
  - `/settings` page — binary path + version test, base port, poll interval, and default sync options

- [ ] **Step 1: Create PreCommitDialog**

Create `src/components/pre-commit-dialog.tsx`:

```tsx
"use client";

import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/components/ui/use-toast";
import { useState } from "react";
import type { ProgressResponse } from "@/lib/process-manager";

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className={ok ? "text-green-600" : "text-muted-foreground"}>
      {ok ? "✓" : "○"} {label}
    </li>
  );
}

export function PreCommitDialog({
  open, onOpenChange, migrationId, progress, onCommitted,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  migrationId: string;
  progress: ProgressResponse | null;
  onCommitted: () => void;
}) {
  const { toast } = useToast();
  const [committing, setCommitting] = useState(false);

  const p = progress?.progress;
  const stateOk = p?.state === "RUNNING";
  const canCommit = p?.canCommit === true;
  const lagOk = (p?.lagTimeSeconds ?? Infinity) <= 5;
  const ready = stateOk && canCommit && lagOk;

  const commit = async () => {
    setCommitting(true);
    try {
      const res = await fetch(`/api/migrations/${migrationId}/commit`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).error || "Commit failed");
      toast({ title: "Commit started", description: "Migration is finalizing (COMMITTING)." });
      onOpenChange(false);
      onCommitted();
    } catch (err) {
      toast({ variant: "destructive", title: "Commit failed", description: (err as Error).message });
    } finally {
      setCommitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Commit (cutover)</DialogTitle>
          <DialogDescription>
            Committing finalizes the migration. Confirm the cluster is ready before proceeding.
          </DialogDescription>
        </DialogHeader>
        <Alert variant="destructive">
          <AlertDescription>
            Stop all application writes to the source cluster before committing. Writing during commit can cause data loss.
          </AlertDescription>
        </Alert>
        <ul className="space-y-1 text-sm">
          <Check ok={stateOk} label="State is RUNNING" />
          <Check ok={canCommit} label="canCommit is true" />
          <Check ok={lagOk} label={`Lag is low (${p?.lagTimeSeconds ?? "—"}s)`} />
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!ready || committing} onClick={commit}>
            {committing ? "Committing..." : "Commit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Create the settings page**

Create `src/app/settings/page.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";

interface Settings {
  mongosyncPath: string;
  pollInterval: string;
  basePort: string;
  defaultLoadLevel: string;
  defaultVerbosity: string;
  defaultVerification: string;
  defaultDisableTelemetry: string;
}

const DEFAULTS: Settings = {
  mongosyncPath: "", pollInterval: "5000", basePort: "27182",
  defaultLoadLevel: "3", defaultVerbosity: "INFO",
  defaultVerification: "true", defaultDisableTelemetry: "false",
};

export default function SettingsPage() {
  const { toast } = useToast();
  const [s, setS] = useState<Settings>(DEFAULTS);
  const [version, setVersion] = useState<string | null>(null);
  const [versionError, setVersionError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/settings").then((r) => r.json()).then((data) => {
      setS({ ...DEFAULTS, ...Object.fromEntries(Object.entries(data).filter(([, v]) => v !== "")) });
    }).catch(() => {});
  }, []);

  const set = (k: keyof Settings) => (v: string) => setS((prev) => ({ ...prev, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      await fetch("/api/settings", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s),
      });
      toast({ title: "Settings saved" });
    } finally { setSaving(false); }
  };

  const testBinary = async () => {
    setTesting(true); setVersion(null); setVersionError(null);
    try {
      const res = await fetch("/api/mongosync/version");
      const data = await res.json();
      res.ok ? setVersion(data.version) : setVersionError(data.error);
    } catch (e) { setVersionError((e as Error).message); }
    finally { setTesting(false); }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-2xl font-bold">Settings</h1>

      <Card>
        <CardHeader><CardTitle>Mongosync Binary</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="mongosyncPath">Binary Path</Label>
            <div className="flex gap-2">
              <Input id="mongosyncPath" value={s.mongosyncPath}
                onChange={(e) => set("mongosyncPath")(e.target.value)} placeholder="mongosync (or full path)" />
              <Button variant="outline" onClick={testBinary} disabled={testing}>
                {testing ? "Testing..." : "Test"}
              </Button>
            </div>
            {version && <p className="text-sm text-green-600">Version: {version}</p>}
            {versionError && <p className="text-sm text-red-500">Error: {versionError}</p>}
          </div>
          <a href="https://www.mongodb.com/docs/mongosync/current/installation/" target="_blank"
            rel="noopener noreferrer" className="text-sm text-blue-600 hover:underline">
            Download mongosync from MongoDB
          </a>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Process & Polling</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="basePort">Base Port (first migration's mongosync port)</Label>
            <Input id="basePort" type="number" value={s.basePort} onChange={(e) => set("basePort")(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pollInterval">Poll Interval (ms)</Label>
            <Input id="pollInterval" type="number" min={1000} max={60000} value={s.pollInterval}
              onChange={(e) => set("pollInterval")(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>New Migration Defaults</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="defaultLoadLevel">Default Load Level (1-4)</Label>
            <Input id="defaultLoadLevel" type="number" min={1} max={4} value={s.defaultLoadLevel}
              onChange={(e) => set("defaultLoadLevel")(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="defaultVerbosity">Default Verbosity</Label>
            <select id="defaultVerbosity" className="w-full rounded border px-2 py-2 text-sm"
              value={s.defaultVerbosity} onChange={(e) => set("defaultVerbosity")(e.target.value)}>
              {["TRACE", "DEBUG", "INFO", "WARN", "ERROR", "FATAL", "PANIC"].map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="defaultVerification">Enable Verification by Default</Label>
            <Switch id="defaultVerification" checked={s.defaultVerification === "true"}
              onCheckedChange={(v) => set("defaultVerification")(String(v))} />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="defaultDisableTelemetry">Disable Telemetry by Default</Label>
            <Switch id="defaultDisableTelemetry" checked={s.defaultDisableTelemetry === "true"}
              onCheckedChange={(v) => set("defaultDisableTelemetry")(String(v))} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Data Directory</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm font-mono text-muted-foreground">~/.mongosync-ui/</p>
          <p className="mt-1 text-xs text-muted-foreground">Contains database, config files, and logs.</p>
        </CardContent>
      </Card>

      <Button onClick={save} disabled={saving}>{saving ? "Saving..." : "Save Settings"}</Button>
    </div>
  );
}
```

- [ ] **Step 3: Verify build**

```bash
npm run build 2>&1 | tail -10
```

Expected: build succeeds (the detail page's `PreCommitDialog` import now resolves).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: pre-commit checklist dialog and full settings page with defaults"
```

---

### Task 9: Startup Initialization + Default Wiring + Final Integration

**Files:**
- Modify: `src/lib/init.ts`
- Modify: `src/app/api/migrations/route.ts` (use `basePort` setting + apply defaults on create)

**Interfaces:**
- Consumes: all previous tasks
- Produces: robust startup — reconcile dead PIDs, auto-detect binary, honor `pollInterval`, start poller; create flow honors `basePort` and applies default sync options when the form omits them

- [ ] **Step 1: Expand init module**

Replace `src/lib/init.ts`:

```ts
import { getAllMigrations, updateMigration, getSetting, setSetting } from "./db";
import { isProcessAlive } from "./process-manager";
import { startPoller } from "./poller";
import { execFileSync } from "node:child_process";

let initialized = false;

function detectBinary(): void {
  if (getSetting("mongosyncPath")) return;
  const candidates = ["mongosync", "/usr/local/bin/mongosync", "/opt/homebrew/bin/mongosync", "/usr/bin/mongosync"];
  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ["--version"], { timeout: 3000, stdio: "ignore" });
      setSetting("mongosyncPath", candidate);
      return;
    } catch {
      // try next
    }
  }
}

export function initApp(): void {
  if (initialized) return;
  initialized = true;

  // Reconcile processes that died while the server was down.
  for (const m of getAllMigrations()) {
    if (m.pid && !isProcessAlive(m.pid)) updateMigration(m.id, { pid: null });
  }

  detectBinary();
  startPoller(Number(getSetting("pollInterval") || "5000"));
}
```

- [ ] **Step 2: Honor basePort + defaults in the create route**

In `src/app/api/migrations/route.ts`, replace the port-selection block and merge default sync options into the incoming config. Update the `POST` handler body:

```ts
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
  // ... rest unchanged (spawn, wait-for-ready, start, set RUNNING, startPoller, return)
}
```

Add `getSetting` to the existing `@/lib/db` import in that file.

- [ ] **Step 3: Final build + full test run**

```bash
npm run build
npm run test
```

Expected: build succeeds with no errors; all unit tests pass.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: startup init with PID reconciliation, binary auto-detection, basePort and default wiring"
```

- [ ] **Step 5: Smoke test the running app**

```bash
npm run dev &
sleep 3
curl -s http://localhost:3000 | grep -c "Migrations"
curl -s http://localhost:3000/api/migrations
curl -s http://localhost:3000/api/settings
curl -s http://localhost:3000/migrations/new | grep -c "New Migration"
curl -s -X POST http://localhost:3000/api/cluster-check -H 'Content-Type: application/json' -d '{"uri":"mongodb://localhost:1/x"}'
kill %1
```

Expected: dashboard shows "Migrations"; `/api/migrations` returns `[]`; `/api/settings` returns JSON; new-migration page renders; cluster-check returns `{"reachable":false,...}`.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "chore: final integration smoke test"
```

---

## Self-Review

**Spec coverage** — mapped against the CLAUDE.md "UI Functionalities to Implement" checklist:

1. Binary & Environment — version test (Task 4/8), auto-detect (Task 9), data dir (Task 1/8). MongoDB version validation via `checkCluster` (Task 3/6). ✓
2. Connection Configuration — URIs, source/dest names (`cluster0`/`cluster1`), connectivity test + ping (Task 3/6/7), masked password via config file (Task 2 constraint). ✓
3. Process Options — port, logPath, metricsLoggingFilepath, verbosity, loadLevel, createIndexesBatchSize, id, disableTelemetry/Verification, enableCappedCollectionHandling all in `StartConfig` + `generateConfig` (Tasks 1–2). `hotDocIDs`/`acceptDisclaimer` modeled in types/constraints; surfaced minimally. ✓
4. Sync Start Options — source/destination, reversible, buildIndexes (5 modes), detectRandomId, copyInNaturalOrder (type), preExistingDestinationData, verification.enabled (Tasks 1–2, 6). ✓
5. Namespace Filtering — database/databaseRegex/collections/collectionsRegex with reverse-incompatibility warning (Tasks 1, 2, 6). ✓
6. Sharding — shardingEntries + createSupportingIndexes in config + start body + form (Tasks 1, 2, 6); multi-instance `id` flag (Task 1/2). ✓
7. Lifecycle Actions — start/pause/resume/commit/reverse/delete, state-gated (Task 5), commit `canCommit` gate + reverse prerequisites (Task 4), pre-commit checklist (Task 8). ✓
8. Live Monitoring — full `/progress` panel: copy, index building, CEA, oplog window, ping, direction, canCommit/canWrite, warnings (Task 7); verification panel (Task 7); historical charts persisted to SQLite (Tasks 1, 4, 7). ✓
9. Logs — stdout/stderr tail + download (Task 7). ✓
10. Error Handling & Notifications — toasts on action failure (Task 5/8), confirmation dialogs for commit/reverse/delete (Tasks 5, 8). ✓
11. Settings — binary path, base port, poll interval, default load level/verbosity/verification/telemetry (Task 8), data dir display (Task 8). ✓

**Known partials (intentional, documented):** `copyInNaturalOrder`, `hotDocIDs`, and `acceptDisclaimer` are modeled in `StartConfig`/constraints but not given dedicated form controls — they are rarely-used expert options; a follow-up can add inputs that flow through the existing `buildStartBody`/`generateConfig` passthrough.

**Type consistency:** `StartConfig`, `Migration`, `Metric`, `MetricInput`, `ProgressResponse`, `VerificationSide`, `ActionKind`, `MigrationFormValues` are defined once and consumed by name across tasks. `progressToMetric` output matches `MetricInput`. `availableActions`/`STATE_COLORS` cover all six states. Field names match the mongosync API per Global Constraints (notably `directionMapping.Source/Destination` capitalization and the absence of `enableUserWriteBlocking`).

**Cross-task build note:** Task 7's detail page imports `PreCommitDialog` (Task 8). When executing tasks independently, build Task 8's component before Task 7's final build, or temporarily stub the import as noted in Task 7 Step 10.
