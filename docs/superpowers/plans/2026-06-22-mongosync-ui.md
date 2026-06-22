# MongosyncUI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local Next.js web app that generates mongosync configs, spawns/manages mongosync processes, and provides live monitoring with historical metric charts.

**Architecture:** Next.js App Router full-stack app. API routes manage mongosync child processes and proxy commands to their HTTP APIs. SQLite stores migration definitions and metric snapshots. Client polls API every 5s for live updates.

**Tech Stack:** Next.js 14+ (App Router), TypeScript, Tailwind CSS, shadcn/ui, recharts, react-hook-form, zod, better-sqlite3, nanoid, js-yaml

## Global Constraints

- TypeScript strict mode throughout
- All runtime data stored in `~/.mongosync-ui/` (db, configs, logs)
- No authentication, no WebSockets, no daemon
- shadcn/ui for all UI components — no custom design system
- Mongosync HTTP API base: `http://localhost:{port}/api/v1/`
- Ports auto-assigned starting from 27182

---

### Task 1: Project Scaffolding + SQLite Database Layer

**Files:**
- Create: `package.json`, `tsconfig.json`, `tailwind.config.ts`, `next.config.ts`, `postcss.config.mjs`
- Create: `src/lib/db.ts`
- Create: `src/lib/types.ts`
- Create: `src/app/layout.tsx` (minimal shell)
- Create: `src/app/page.tsx` (placeholder)
- Test: `src/lib/__tests__/db.test.ts`

**Interfaces:**
- Consumes: nothing (first task)
- Produces:
  - `getDb(): BetterSqlite3.Database` — returns singleton DB connection
  - `createMigration(data: CreateMigrationInput): Migration`
  - `getMigration(id: string): Migration | undefined`
  - `getAllMigrations(): Migration[]`
  - `updateMigration(id: string, data: Partial<Migration>): void`
  - `deleteMigration(id: string): void`
  - `insertMetric(data: MetricInput): void`
  - `getMetrics(migrationId: string, since?: number): Metric[]`
  - `getSetting(key: string): string | undefined`
  - `setSetting(key: string, value: string): void`
  - Types: `Migration`, `Metric`, `MongosyncState`, `CreateMigrationInput`, `MetricInput`

- [ ] **Step 1: Initialize Next.js project**

```bash
cd /Users/ilian/Dev/MongosyncUI
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --no-turbopack
```

Accept overwriting existing files if prompted. This scaffolds `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `postcss.config.mjs`, and the `src/app/` skeleton.

- [ ] **Step 2: Install dependencies**

```bash
npm install better-sqlite3 nanoid js-yaml recharts react-hook-form @hookform/resolvers zod
npm install -D @types/better-sqlite3 @types/js-yaml vitest
```

- [ ] **Step 3: Add vitest config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
```

Add to `package.json` scripts: `"test": "vitest run"`, `"test:watch": "vitest"`.

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

export interface Migration {
  id: string;
  name: string;
  sourceUri: string;
  destUri: string;
  config: string; // JSON string of start options
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
  config: Record<string, unknown>;
  port: number;
}

export interface Metric {
  id: number;
  migrationId: string;
  state: string;
  progress: number;
  lagTimeSeconds: number | null;
  totalEventsApplied: number;
  estimatedCopiedBytes: number;
  estimatedTotalBytes: number;
  timestamp: number;
}

export interface MetricInput {
  migrationId: string;
  state: string;
  progress: number;
  lagTimeSeconds: number | null;
  totalEventsApplied: number;
  estimatedCopiedBytes: number;
  estimatedTotalBytes: number;
}
```

- [ ] **Step 5: Write failing tests for db module**

Create `src/lib/__tests__/db.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import os from "os";

// We'll test against a temp directory
let testDir: string;
let originalEnv: string | undefined;

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), "mongosync-ui-test-"));
  originalEnv = process.env.MONGOSYNC_UI_DIR;
  process.env.MONGOSYNC_UI_DIR = testDir;
  // Reset module cache so getDb() picks up the new dir
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
    const db = getDb();
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain("migrations");
    expect(names).toContain("metrics");
    expect(names).toContain("settings");
  });

  it("creates and retrieves a migration", async () => {
    const { createMigration, getMigration } = await loadDb();
    const m = createMigration({
      name: "test-migration",
      sourceUri: "mongodb://src:27017",
      destUri: "mongodb://dst:27017",
      config: { reversible: true },
      port: 27182,
    });
    expect(m.id).toBeTruthy();
    expect(m.name).toBe("test-migration");
    expect(m.state).toBe("IDLE");
    expect(m.pid).toBeNull();

    const fetched = getMigration(m.id);
    expect(fetched).toEqual(m);
  });

  it("lists all migrations", async () => {
    const { createMigration, getAllMigrations } = await loadDb();
    createMigration({
      name: "m1",
      sourceUri: "mongodb://a",
      destUri: "mongodb://b",
      config: {},
      port: 27182,
    });
    createMigration({
      name: "m2",
      sourceUri: "mongodb://c",
      destUri: "mongodb://d",
      config: {},
      port: 27183,
    });
    const all = getAllMigrations();
    expect(all).toHaveLength(2);
  });

  it("updates a migration", async () => {
    const { createMigration, updateMigration, getMigration } = await loadDb();
    const m = createMigration({
      name: "m",
      sourceUri: "mongodb://a",
      destUri: "mongodb://b",
      config: {},
      port: 27182,
    });
    updateMigration(m.id, { state: "RUNNING", pid: 12345 });
    const updated = getMigration(m.id)!;
    expect(updated.state).toBe("RUNNING");
    expect(updated.pid).toBe(12345);
  });

  it("deletes a migration", async () => {
    const { createMigration, deleteMigration, getMigration } = await loadDb();
    const m = createMigration({
      name: "m",
      sourceUri: "mongodb://a",
      destUri: "mongodb://b",
      config: {},
      port: 27182,
    });
    deleteMigration(m.id);
    expect(getMigration(m.id)).toBeUndefined();
  });

  it("inserts and retrieves metrics", async () => {
    const { createMigration, insertMetric, getMetrics } = await loadDb();
    const m = createMigration({
      name: "m",
      sourceUri: "mongodb://a",
      destUri: "mongodb://b",
      config: {},
      port: 27182,
    });
    insertMetric({
      migrationId: m.id,
      state: "RUNNING",
      progress: 42.5,
      lagTimeSeconds: 3,
      totalEventsApplied: 1000,
      estimatedCopiedBytes: 5000,
      estimatedTotalBytes: 10000,
    });
    const metrics = getMetrics(m.id);
    expect(metrics).toHaveLength(1);
    expect(metrics[0].progress).toBe(42.5);
    expect(metrics[0].lagTimeSeconds).toBe(3);
  });

  it("gets and sets settings", async () => {
    const { getSetting, setSetting } = await loadDb();
    expect(getSetting("mongosyncPath")).toBeUndefined();
    setSetting("mongosyncPath", "/usr/local/bin/mongosync");
    expect(getSetting("mongosyncPath")).toBe("/usr/local/bin/mongosync");
    setSetting("mongosyncPath", "/opt/mongosync");
    expect(getSetting("mongosyncPath")).toBe("/opt/mongosync");
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

```bash
npx vitest run src/lib/__tests__/db.test.ts
```

Expected: FAIL — `@/lib/db` module does not exist.

- [ ] **Step 7: Implement db module**

Create `src/lib/db.ts`:

```ts
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import os from "os";
import { nanoid } from "nanoid";
import type { Migration, CreateMigrationInput, Metric, MetricInput } from "./types";

function getDataDir(): string {
  const dir = process.env.MONGOSYNC_UI_DIR || path.join(os.homedir(), ".mongosync-ui");
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, "configs"), { recursive: true });
  fs.mkdirSync(path.join(dir, "logs"), { recursive: true });
  return dir;
}

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  const dbPath = path.join(getDataDir(), "data.db");
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
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
      progress REAL NOT NULL DEFAULT 0,
      lagTimeSeconds REAL,
      totalEventsApplied INTEGER NOT NULL DEFAULT 0,
      estimatedCopiedBytes INTEGER NOT NULL DEFAULT 0,
      estimatedTotalBytes INTEGER NOT NULL DEFAULT 0,
      timestamp INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_metrics_migration ON metrics(migrationId, timestamp);
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  return db;
}

export function createMigration(input: CreateMigrationInput): Migration {
  const now = Date.now();
  const id = nanoid();
  const migration: Migration = {
    id,
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
  const fields = Object.keys(data)
    .filter((k) => k !== "id")
    .map((k) => `${k} = @${k}`)
    .join(", ");
  if (!fields) return;
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
      `INSERT INTO metrics (migrationId, state, progress, lagTimeSeconds, totalEventsApplied, estimatedCopiedBytes, estimatedTotalBytes, timestamp)
       VALUES (@migrationId, @state, @progress, @lagTimeSeconds, @totalEventsApplied, @estimatedCopiedBytes, @estimatedTotalBytes, @timestamp)`
    )
    .run({ ...input, timestamp: Date.now() });
}

export function getMetrics(migrationId: string, since?: number): Metric[] {
  if (since) {
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
    | { value: string }
    | undefined;
  return row?.value;
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, value);
}
```

- [ ] **Step 8: Run tests to verify they pass**

```bash
npx vitest run src/lib/__tests__/db.test.ts
```

Expected: all 7 tests PASS.

- [ ] **Step 9: Install shadcn/ui**

```bash
npx shadcn@latest init -d
```

This sets up `src/components/ui/`, `lib/utils.ts`, and updates `tailwind.config.ts` with shadcn's preset.

Then add the components we'll use throughout the app:

```bash
npx shadcn@latest add button card input label select slider badge table dialog tabs collapsible toast switch textarea separator tooltip progress
```

- [ ] **Step 10: Create minimal layout shell**

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
              <a href="/" className="text-lg font-semibold">
                MongosyncUI
              </a>
              <nav className="ml-auto flex gap-4">
                <a href="/" className="text-sm text-muted-foreground hover:text-foreground">
                  Dashboard
                </a>
                <a href="/settings" className="text-sm text-muted-foreground hover:text-foreground">
                  Settings
                </a>
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

Replace `src/app/page.tsx` with a placeholder:

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

- [ ] **Step 11: Verify the app runs**

```bash
npm run dev &
sleep 3
curl -s http://localhost:3000 | head -20
kill %1
```

Expected: HTML response with "MongosyncUI" in it.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat: project scaffolding with SQLite database layer and shadcn/ui setup"
```

---

### Task 2: Config Generator + Process Manager

**Files:**
- Create: `src/lib/config-generator.ts`
- Create: `src/lib/process-manager.ts`
- Test: `src/lib/__tests__/config-generator.test.ts`
- Test: `src/lib/__tests__/process-manager.test.ts`

**Interfaces:**
- Consumes: `getDb()`, `Migration`, `updateMigration()`, `getSetting()` from Task 1
- Produces:
  - `generateConfig(migration: Migration): string` — returns path to written YAML config file
  - `buildStartBody(migration: Migration): Record<string, unknown>` — builds the /start request body from migration config
  - `spawnMongosync(migration: Migration): number` — spawns process, returns PID
  - `killMongosync(migration: Migration): void` — kills process by PID
  - `sendCommand(port: number, endpoint: string, body?: Record<string, unknown>): Promise<unknown>` — sends HTTP request to mongosync API
  - `fetchProgress(port: number): Promise<ProgressResponse>` — calls GET /api/v1/progress
  - `isProcessAlive(pid: number): boolean` — checks if PID is still running
  - `ProgressResponse` type

- [ ] **Step 1: Write failing tests for config-generator**

Create `src/lib/__tests__/config-generator.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import yaml from "js-yaml";

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

async function loadModule() {
  return await import("@/lib/config-generator");
}

describe("config-generator", () => {
  const baseMigration = {
    id: "test123",
    name: "test",
    sourceUri: "mongodb://src:27017",
    destUri: "mongodb://dst:27017",
    config: JSON.stringify({ reversible: true, enableUserWriteBlocking: true, loadLevel: 4 }),
    state: "IDLE" as const,
    port: 27183,
    pid: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  it("generates a valid YAML config file", async () => {
    const { generateConfig } = await loadModule();
    const configPath = generateConfig(baseMigration);
    expect(fs.existsSync(configPath)).toBe(true);
    const content = yaml.load(fs.readFileSync(configPath, "utf-8")) as Record<string, unknown>;
    expect(content.cluster0).toBe("mongodb://src:27017");
    expect(content.cluster1).toBe("mongodb://dst:27017");
    expect(content.port).toBe(27183);
  });

  it("builds a start body with correct source/destination", async () => {
    const { buildStartBody } = await loadModule();
    const body = buildStartBody(baseMigration);
    expect(body.source).toBe("cluster0");
    expect(body.destination).toBe("cluster1");
    expect(body.reversible).toBe(true);
    expect(body.enableUserWriteBlocking).toBe(true);
  });

  it("includes namespace filters in start body when present", async () => {
    const { buildStartBody } = await loadModule();
    const migration = {
      ...baseMigration,
      config: JSON.stringify({
        includeNamespaces: [{ database: "mydb", collection: "mycoll" }],
        excludeNamespaces: [{ database: "admin" }],
      }),
    };
    const body = buildStartBody(migration);
    expect(body.includeNamespaces).toEqual([{ database: "mydb", collection: "mycoll" }]);
    expect(body.excludeNamespaces).toEqual([{ database: "admin" }]);
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
import os from "os";
import yaml from "js-yaml";
import type { Migration } from "./types";

function getDataDir(): string {
  return process.env.MONGOSYNC_UI_DIR || path.join(os.homedir(), ".mongosync-ui");
}

export function generateConfig(migration: Migration): string {
  const dataDir = getDataDir();
  const configDir = path.join(dataDir, "configs");
  const logDir = path.join(dataDir, "logs", migration.id);
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });

  const parsedConfig = JSON.parse(migration.config);

  const config: Record<string, unknown> = {
    cluster0: migration.sourceUri,
    cluster1: migration.destUri,
    logPath: logDir,
    port: migration.port,
    verbosity: "INFO",
  };

  if (parsedConfig.loadLevel !== undefined) {
    config.loadLevel = parsedConfig.loadLevel;
  }

  const configPath = path.join(configDir, `${migration.id}.yaml`);
  fs.writeFileSync(configPath, yaml.dump(config), "utf-8");
  return configPath;
}

export function buildStartBody(migration: Migration): Record<string, unknown> {
  const parsedConfig = JSON.parse(migration.config);
  const body: Record<string, unknown> = {
    source: "cluster0",
    destination: "cluster1",
  };

  const passthrough = [
    "reversible",
    "enableUserWriteBlocking",
    "buildIndexes",
    "includeNamespaces",
    "excludeNamespaces",
    "verification",
    "hotDocuments",
    "preExistingDestinationData",
  ];

  for (const key of passthrough) {
    if (parsedConfig[key] !== undefined) {
      body[key] = parsedConfig[key];
    }
  }

  return body;
}
```

- [ ] **Step 4: Run config-generator tests**

```bash
npx vitest run src/lib/__tests__/config-generator.test.ts
```

Expected: all 3 tests PASS.

- [ ] **Step 5: Write failing tests for process-manager**

Create `src/lib/__tests__/process-manager.test.ts`:

```ts
import { describe, it, expect } from "vitest";

async function loadModule() {
  return await import("@/lib/process-manager");
}

describe("process-manager", () => {
  it("isProcessAlive returns false for non-existent PID", async () => {
    const { isProcessAlive } = await loadModule();
    // PID 99999999 is extremely unlikely to exist
    expect(isProcessAlive(99999999)).toBe(false);
  });

  it("isProcessAlive returns true for current process", async () => {
    const { isProcessAlive } = await loadModule();
    expect(isProcessAlive(process.pid)).toBe(true);
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

```bash
npx vitest run src/lib/__tests__/process-manager.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 7: Implement process-manager**

Create `src/lib/process-manager.ts`:

```ts
import { spawn } from "node:child_process";
import fs from "fs";
import path from "path";
import os from "os";
import type { Migration } from "./types";
import { generateConfig } from "./config-generator";
import { getSetting, updateMigration } from "./db";

export interface ProgressResponse {
  progress: {
    state: string;
    canCommit: boolean;
    canWrite: boolean;
    info: string;
    lagTimeSeconds: number | null;
    totalEventsApplied: number;
    collectionCopy: {
      estimatedCopiedBytes: number;
      estimatedTotalBytes: number;
    };
    directionMapping: {
      source: string;
      destination: string;
    };
    mongosyncID: string;
    coordinatorID: string;
  };
}

function getDataDir(): string {
  return process.env.MONGOSYNC_UI_DIR || path.join(os.homedir(), ".mongosync-ui");
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
  const mongosyncPath = getMongosyncPath();
  const logDir = path.join(getDataDir(), "logs", migration.id);
  fs.mkdirSync(logDir, { recursive: true });

  const child = spawn(mongosyncPath, ["--config", configPath], {
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
      // Process may have already exited
    }
  }
  updateMigration(migration.id, { pid: null });
}

export async function sendCommand(
  port: number,
  endpoint: string,
  body: Record<string, unknown> = {}
): Promise<unknown> {
  const url = `http://localhost:${port}/api/v1/${endpoint}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`mongosync ${endpoint} failed (${res.status}): ${text}`);
  }
  return res.json();
}

export async function fetchProgress(port: number): Promise<ProgressResponse> {
  const url = `http://localhost:${port}/api/v1/progress`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`mongosync progress failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<ProgressResponse>;
}
```

- [ ] **Step 8: Run process-manager tests**

```bash
npx vitest run src/lib/__tests__/process-manager.test.ts
```

Expected: both tests PASS.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: add config generator and process manager for mongosync"
```

---

### Task 3: Poller + Migration API Routes

**Files:**
- Create: `src/lib/poller.ts`
- Create: `src/app/api/migrations/route.ts` (GET all, POST create)
- Create: `src/app/api/migrations/[id]/route.ts` (GET one, DELETE)
- Create: `src/app/api/migrations/[id]/start/route.ts`
- Create: `src/app/api/migrations/[id]/pause/route.ts`
- Create: `src/app/api/migrations/[id]/resume/route.ts`
- Create: `src/app/api/migrations/[id]/commit/route.ts`
- Create: `src/app/api/migrations/[id]/reverse/route.ts`
- Create: `src/app/api/metrics/[migrationId]/route.ts` (GET metrics)
- Create: `src/app/api/settings/route.ts` (GET/PUT)
- Create: `src/app/api/mongosync/version/route.ts` (GET — test binary)
- Create: `src/app/api/migrations/[id]/logs/route.ts` (GET — tail log file)

**Interfaces:**
- Consumes: everything from Tasks 1 and 2
- Produces:
  - `startPoller(): void` — starts the global polling interval
  - `stopPoller(): void` — stops it
  - REST API:
    - `GET /api/migrations` → `Migration[]`
    - `POST /api/migrations` → `Migration` (creates + spawns + starts)
    - `GET /api/migrations/[id]` → `Migration`
    - `DELETE /api/migrations/[id]` → kills process + deletes
    - `POST /api/migrations/[id]/start` → proxies to mongosync
    - `POST /api/migrations/[id]/pause` → proxies
    - `POST /api/migrations/[id]/resume` → proxies
    - `POST /api/migrations/[id]/commit` → proxies
    - `POST /api/migrations/[id]/reverse` → proxies
    - `GET /api/metrics/[migrationId]?since=` → `Metric[]`
    - `GET /api/settings` → settings object
    - `PUT /api/settings` → updates settings
    - `GET /api/mongosync/version` → `{ version: string }`
    - `GET /api/migrations/[id]/logs?lines=` → `{ lines: string[] }`

- [ ] **Step 1: Implement the poller**

Create `src/lib/poller.ts`:

```ts
import { getAllMigrations, updateMigration, insertMetric } from "./db";
import { fetchProgress, isProcessAlive } from "./process-manager";

let intervalId: ReturnType<typeof setInterval> | null = null;

const ACTIVE_STATES = ["RUNNING", "COMMITTING", "REVERSING"];

async function pollOnce(): Promise<void> {
  const migrations = getAllMigrations();

  for (const m of migrations) {
    // Check if process is still alive
    if (m.pid && !isProcessAlive(m.pid)) {
      updateMigration(m.id, { pid: null });
      continue;
    }

    // Only poll active migrations with a running process
    if (!m.pid || !ACTIVE_STATES.includes(m.state)) {
      // Also poll PAUSED to detect external state changes
      if (m.pid && m.state === "PAUSED") {
        try {
          const progress = await fetchProgress(m.port);
          if (progress.progress.state !== m.state) {
            updateMigration(m.id, { state: progress.progress.state as any });
          }
        } catch {
          // Ignore — process may not be ready
        }
      }
      continue;
    }

    try {
      const progress = await fetchProgress(m.port);
      const p = progress.progress;

      updateMigration(m.id, { state: p.state as any });

      insertMetric({
        migrationId: m.id,
        state: p.state,
        progress:
          p.collectionCopy.estimatedTotalBytes > 0
            ? (p.collectionCopy.estimatedCopiedBytes / p.collectionCopy.estimatedTotalBytes) * 100
            : 0,
        lagTimeSeconds: p.lagTimeSeconds,
        totalEventsApplied: p.totalEventsApplied,
        estimatedCopiedBytes: p.collectionCopy.estimatedCopiedBytes,
        estimatedTotalBytes: p.collectionCopy.estimatedTotalBytes,
      });
    } catch {
      // mongosync may not be ready yet — ignore
    }
  }
}

export function startPoller(intervalMs: number = 5000): void {
  if (intervalId) return;
  intervalId = setInterval(pollOnce, intervalMs);
  // Run once immediately
  pollOnce();
}

export function stopPoller(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
```

- [ ] **Step 2: Implement migrations API routes**

Create `src/app/api/migrations/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getAllMigrations, createMigration } from "@/lib/db";
import { spawnMongosync, sendCommand } from "@/lib/process-manager";
import { buildStartBody } from "@/lib/config-generator";
import { startPoller } from "@/lib/poller";

export async function GET() {
  const migrations = getAllMigrations();
  return NextResponse.json(migrations);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { name, sourceUri, destUri, config } = body;

  // Find next available port
  const migrations = getAllMigrations();
  const usedPorts = new Set(migrations.map((m) => m.port));
  let port = 27182;
  while (usedPorts.has(port)) port++;

  const migration = createMigration({ name, sourceUri, destUri, config, port });

  try {
    // Spawn mongosync process
    spawnMongosync(migration);

    // Wait for mongosync to be ready (up to 10s)
    let ready = false;
    for (let i = 0; i < 20; i++) {
      try {
        const res = await fetch(`http://localhost:${port}/api/v1/progress`);
        if (res.ok) {
          ready = true;
          break;
        }
      } catch {
        // not ready yet
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    if (!ready) {
      return NextResponse.json({ error: "mongosync failed to start within 10s" }, { status: 500 });
    }

    // Send /start command
    const startBody = buildStartBody(migration);
    await sendCommand(port, "start", startBody);

    // Update state
    const { updateMigration } = await import("@/lib/db");
    updateMigration(migration.id, { state: "RUNNING" });

    // Ensure poller is running
    startPoller();

    const updated = (await import("@/lib/db")).getMigration(migration.id);
    return NextResponse.json(updated, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
```

Create `src/app/api/migrations/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getMigration, deleteMigration } from "@/lib/db";
import { killMongosync } from "@/lib/process-manager";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const migration = getMigration(id);
  if (!migration) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(migration);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const migration = getMigration(id);
  if (!migration) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  killMongosync(migration);
  deleteMigration(id);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Implement action routes (pause, resume, commit, reverse)**

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
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
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
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
```

Create `src/app/api/migrations/[id]/commit/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getMigration, updateMigration } from "@/lib/db";
import { sendCommand } from "@/lib/process-manager";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const migration = getMigration(id);
  if (!migration) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    await sendCommand(migration.port, "commit");
    updateMigration(id, { state: "COMMITTING" });
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
```

Create `src/app/api/migrations/[id]/reverse/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getMigration, updateMigration } from "@/lib/db";
import { sendCommand } from "@/lib/process-manager";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const migration = getMigration(id);
  if (!migration) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    await sendCommand(migration.port, "reverse");
    updateMigration(id, { state: "REVERSING" });
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
```

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
    const startBody = buildStartBody(migration);
    await sendCommand(migration.port, "start", startBody);
    updateMigration(id, { state: "RUNNING" });
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
```

- [ ] **Step 4: Implement metrics, settings, version, and logs routes**

Create `src/app/api/metrics/[migrationId]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getMetrics } from "@/lib/db";

export async function GET(req: NextRequest, { params }: { params: Promise<{ migrationId: string }> }) {
  const { migrationId } = await params;
  const since = req.nextUrl.searchParams.get("since");
  const metrics = getMetrics(migrationId, since ? Number(since) : undefined);
  return NextResponse.json(metrics);
}
```

Create `src/app/api/settings/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getSetting, setSetting } from "@/lib/db";

export async function GET() {
  return NextResponse.json({
    mongosyncPath: getSetting("mongosyncPath") || "",
    pollInterval: getSetting("pollInterval") || "5000",
  });
}

export async function PUT(request: NextRequest) {
  const body = await request.json();
  for (const [key, value] of Object.entries(body)) {
    if (typeof value === "string") {
      setSetting(key, value);
    }
  }
  return NextResponse.json({ ok: true });
}
```

Create `src/app/api/mongosync/version/route.ts`:

```ts
import { NextResponse } from "next/server";
import { execSync } from "node:child_process";
import { getSetting } from "@/lib/db";

export async function GET() {
  const mongosyncPath = getSetting("mongosyncPath") || "mongosync";
  try {
    const output = execSync(`${mongosyncPath} --version`, {
      timeout: 5000,
      encoding: "utf-8",
    }).trim();
    return NextResponse.json({ version: output });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
```

Create `src/app/api/migrations/[id]/logs/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getMigration } from "@/lib/db";
import fs from "fs";
import path from "path";
import os from "os";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const migration = getMigration(id);
  if (!migration) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const lines = Number(req.nextUrl.searchParams.get("lines") || "100");
  const dataDir = process.env.MONGOSYNC_UI_DIR || path.join(os.homedir(), ".mongosync-ui");
  const logFile = path.join(dataDir, "logs", id, "stdout.log");

  if (!fs.existsSync(logFile)) {
    return NextResponse.json({ lines: [] });
  }

  const content = fs.readFileSync(logFile, "utf-8");
  const allLines = content.split("\n").filter(Boolean);
  const tail = allLines.slice(-lines);
  return NextResponse.json({ lines: tail });
}
```

- [ ] **Step 5: Verify API routes compile**

```bash
npm run build 2>&1 | tail -20
```

Expected: build succeeds (or only has minor warnings, no errors).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add poller, migration API routes, metrics, settings, and log endpoints"
```

---

### Task 4: Dashboard Page + Migration Cards

**Files:**
- Create: `src/components/state-badge.tsx`
- Create: `src/components/action-buttons.tsx`
- Create: `src/components/migration-card.tsx`
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `GET /api/migrations`, `POST /api/migrations/[id]/{pause,resume,commit,reverse}`, `DELETE /api/migrations/[id]` from Task 3
- Produces: Dashboard page with migration cards, navigation to new migration form and detail pages

- [ ] **Step 1: Create StateBadge component**

Create `src/components/state-badge.tsx`:

```tsx
"use client";

import { Badge } from "@/components/ui/badge";
import type { MongosyncState } from "@/lib/types";

const stateColors: Record<MongosyncState, string> = {
  IDLE: "bg-gray-100 text-gray-700 border-gray-300",
  RUNNING: "bg-blue-100 text-blue-700 border-blue-300",
  PAUSED: "bg-yellow-100 text-yellow-700 border-yellow-300",
  COMMITTING: "bg-purple-100 text-purple-700 border-purple-300",
  COMMITTED: "bg-green-100 text-green-700 border-green-300",
  REVERSING: "bg-orange-100 text-orange-700 border-orange-300",
};

export function StateBadge({ state }: { state: MongosyncState }) {
  return (
    <Badge variant="outline" className={stateColors[state] || ""}>
      {state}
    </Badge>
  );
}
```

- [ ] **Step 2: Create ActionButtons component**

Create `src/components/action-buttons.tsx`:

```tsx
"use client";

import { Button } from "@/components/ui/button";
import type { Migration } from "@/lib/types";
import { useRouter } from "next/navigation";
import { useState } from "react";

async function postAction(id: string, action: string) {
  const res = await fetch(`/api/migrations/${id}/${action}`, { method: "POST" });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || `Action ${action} failed`);
  }
}

async function deleteMigration(id: string) {
  const res = await fetch(`/api/migrations/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Delete failed");
  }
}

export function ActionButtons({
  migration,
  onAction,
}: {
  migration: Migration;
  onAction?: () => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);

  const handle = async (action: string) => {
    setLoading(action);
    try {
      if (action === "delete") {
        if (!confirm(`Delete migration "${migration.name}"?`)) return;
        await deleteMigration(migration.id);
      } else {
        await postAction(migration.id, action);
      }
      onAction?.();
      router.refresh();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setLoading(null);
    }
  };

  const btn = (action: string, label: string, variant: "default" | "outline" | "destructive" = "outline") => (
    <Button
      key={action}
      size="sm"
      variant={variant}
      disabled={loading !== null}
      onClick={() => handle(action)}
    >
      {loading === action ? "..." : label}
    </Button>
  );

  const actions: Record<string, React.ReactNode[]> = {
    IDLE: [btn("start", "Start", "default"), btn("delete", "Delete", "destructive")],
    RUNNING: [btn("pause", "Pause"), btn("commit", "Commit"), btn("delete", "Delete", "destructive")],
    PAUSED: [btn("resume", "Resume", "default"), btn("delete", "Delete", "destructive")],
    COMMITTING: [],
    COMMITTED: [btn("reverse", "Reverse"), btn("delete", "Delete", "destructive")],
    REVERSING: [],
  };

  return <div className="flex gap-2">{actions[migration.state] || []}</div>;
}
```

- [ ] **Step 3: Create MigrationCard component**

Create `src/components/migration-card.tsx`:

```tsx
"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { StateBadge } from "./state-badge";
import { ActionButtons } from "./action-buttons";
import type { Migration } from "@/lib/types";
import Link from "next/link";

export function MigrationCard({
  migration,
  onAction,
}: {
  migration: Migration;
  onAction?: () => void;
}) {
  // Parse progress from config or use 0
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <Link href={`/migrations/${migration.id}`}>
            <CardTitle className="text-base hover:underline cursor-pointer">
              {migration.name}
            </CardTitle>
          </Link>
          <StateBadge state={migration.state} />
        </div>
        <p className="text-sm text-muted-foreground truncate">
          {migration.sourceUri} → {migration.destUri}
        </p>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
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

- [ ] **Step 4: Build the Dashboard page**

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
      const res = await fetch("/api/migrations");
      const data = await res.json();
      setMigrations(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMigrations();
    const interval = setInterval(fetchMigrations, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Migrations</h1>
        <Link href="/migrations/new">
          <Button>New Migration</Button>
        </Link>
      </div>

      {loading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : migrations.length === 0 ? (
        <p className="text-muted-foreground">
          No migrations yet. Create one to get started.
        </p>
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

- [ ] **Step 5: Verify the dashboard renders**

```bash
npm run dev &
sleep 3
curl -s http://localhost:3000 | grep -o "Migrations"
kill %1
```

Expected: "Migrations" appears in output.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add dashboard page with migration cards, state badges, and action buttons"
```

---

### Task 5: New Migration Form

**Files:**
- Create: `src/components/migration-form.tsx`
- Create: `src/app/migrations/new/page.tsx`
- Create: `src/lib/schemas.ts` (zod schemas)

**Interfaces:**
- Consumes: `POST /api/migrations` from Task 3
- Produces: `/migrations/new` page with complete form, navigates to dashboard on success

- [ ] **Step 1: Define zod schemas**

Create `src/lib/schemas.ts`:

```ts
import { z } from "zod";

export const namespaceFilterSchema = z.object({
  database: z.string().min(1, "Database name required"),
  collection: z.string().optional(),
});

export const migrationFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  sourceUri: z.string().min(1, "Source URI is required").startsWith("mongodb", "Must be a MongoDB URI"),
  destUri: z.string().min(1, "Destination URI is required").startsWith("mongodb", "Must be a MongoDB URI"),
  reversible: z.boolean().default(false),
  enableUserWriteBlocking: z.boolean().default(false),
  buildIndexes: z.enum(["always", "never"]).default("always"),
  includeNamespaces: z.array(namespaceFilterSchema).default([]),
  excludeNamespaces: z.array(namespaceFilterSchema).default([]),
  loadLevel: z.number().min(1).max(5).default(3),
  verification: z.boolean().default(false),
  hotDocuments: z.string().default(""),
});

export type MigrationFormValues = z.infer<typeof migrationFormSchema>;
```

- [ ] **Step 2: Create the migration form component**

Create `src/components/migration-form.tsx`:

```tsx
"use client";

import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { migrationFormSchema, type MigrationFormValues } from "@/lib/schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function MigrationForm() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<MigrationFormValues>({
    resolver: zodResolver(migrationFormSchema),
    defaultValues: {
      name: "",
      sourceUri: "",
      destUri: "",
      reversible: false,
      enableUserWriteBlocking: false,
      buildIndexes: "always",
      includeNamespaces: [],
      excludeNamespaces: [],
      loadLevel: 3,
      verification: false,
      hotDocuments: "",
    },
  });

  const includeNs = useFieldArray({ control: form.control, name: "includeNamespaces" });
  const excludeNs = useFieldArray({ control: form.control, name: "excludeNamespaces" });

  const onSubmit = async (values: MigrationFormValues) => {
    setSubmitting(true);
    setError(null);
    try {
      const config: Record<string, unknown> = {};
      if (values.reversible) config.reversible = true;
      if (values.enableUserWriteBlocking) config.enableUserWriteBlocking = true;
      if (values.buildIndexes === "never") config.buildIndexes = "never";
      if (values.includeNamespaces.length > 0) config.includeNamespaces = values.includeNamespaces;
      if (values.excludeNamespaces.length > 0) config.excludeNamespaces = values.excludeNamespaces;
      if (values.loadLevel !== 3) config.loadLevel = values.loadLevel;
      if (values.verification) config.verification = { enabled: true };
      if (values.hotDocuments) {
        try {
          config.hotDocuments = JSON.parse(values.hotDocuments);
        } catch {
          setError("hotDocuments must be valid JSON");
          return;
        }
      }

      const res = await fetch("/api/migrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: values.name,
          sourceUri: values.sourceUri,
          destUri: values.destUri,
          config,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create migration");
      }

      router.push("/");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 max-w-2xl">
      {error && (
        <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}

      <div className="space-y-2">
        <Label htmlFor="name">Migration Name</Label>
        <Input id="name" {...form.register("name")} placeholder="My Migration" />
        {form.formState.errors.name && (
          <p className="text-sm text-red-500">{form.formState.errors.name.message}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="sourceUri">Source Cluster URI</Label>
        <Input id="sourceUri" {...form.register("sourceUri")} placeholder="mongodb://..." />
        {form.formState.errors.sourceUri && (
          <p className="text-sm text-red-500">{form.formState.errors.sourceUri.message}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="destUri">Destination Cluster URI</Label>
        <Input id="destUri" {...form.register("destUri")} placeholder="mongodb://..." />
        {form.formState.errors.destUri && (
          <p className="text-sm text-red-500">{form.formState.errors.destUri.message}</p>
        )}
      </div>

      <div className="space-y-4 rounded-md border p-4">
        <h3 className="font-medium">Sync Options</h3>

        <div className="flex items-center justify-between">
          <Label htmlFor="reversible">Reversible</Label>
          <Switch
            id="reversible"
            checked={form.watch("reversible")}
            onCheckedChange={(v) => form.setValue("reversible", v)}
          />
        </div>

        <div className="flex items-center justify-between">
          <Label htmlFor="writeBlocking">Enable User Write Blocking</Label>
          <Switch
            id="writeBlocking"
            checked={form.watch("enableUserWriteBlocking")}
            onCheckedChange={(v) => form.setValue("enableUserWriteBlocking", v)}
          />
        </div>

        <div className="flex items-center justify-between">
          <Label htmlFor="buildIndexes">Build Indexes</Label>
          <select
            id="buildIndexes"
            className="rounded border px-2 py-1 text-sm"
            {...form.register("buildIndexes")}
          >
            <option value="always">Always</option>
            <option value="never">Never</option>
          </select>
        </div>
      </div>

      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" type="button" className="w-full justify-start">
            + Namespace Filtering
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label>Include Namespaces</Label>
            {includeNs.fields.map((field, i) => (
              <div key={field.id} className="flex gap-2">
                <Input
                  placeholder="database"
                  {...form.register(`includeNamespaces.${i}.database`)}
                />
                <Input
                  placeholder="collection (optional)"
                  {...form.register(`includeNamespaces.${i}.collection`)}
                />
                <Button type="button" variant="outline" size="sm" onClick={() => includeNs.remove(i)}>
                  X
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => includeNs.append({ database: "", collection: "" })}
            >
              Add Include
            </Button>
          </div>

          <div className="space-y-2">
            <Label>Exclude Namespaces</Label>
            {excludeNs.fields.map((field, i) => (
              <div key={field.id} className="flex gap-2">
                <Input
                  placeholder="database"
                  {...form.register(`excludeNamespaces.${i}.database`)}
                />
                <Input
                  placeholder="collection (optional)"
                  {...form.register(`excludeNamespaces.${i}.collection`)}
                />
                <Button type="button" variant="outline" size="sm" onClick={() => excludeNs.remove(i)}>
                  X
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => excludeNs.append({ database: "", collection: "" })}
            >
              Add Exclude
            </Button>
          </div>
        </CollapsibleContent>
      </Collapsible>

      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" type="button" className="w-full justify-start">
            + Advanced Options
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label>Load Level: {form.watch("loadLevel")}</Label>
            <Slider
              min={1}
              max={5}
              step={1}
              value={[form.watch("loadLevel")]}
              onValueChange={([v]) => form.setValue("loadLevel", v)}
            />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="verification">Enable Verification</Label>
            <Switch
              id="verification"
              checked={form.watch("verification")}
              onCheckedChange={(v) => form.setValue("verification", v)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="hotDocuments">Hot Documents (JSON)</Label>
            <Input
              id="hotDocuments"
              {...form.register("hotDocuments")}
              placeholder='[{"database":"db","collection":"coll","id":"..."}]'
            />
          </div>
        </CollapsibleContent>
      </Collapsible>

      <Button type="submit" disabled={submitting} className="w-full">
        {submitting ? "Creating..." : "Create & Start Migration"}
      </Button>
    </form>
  );
}
```

- [ ] **Step 3: Create the new migration page**

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

- [ ] **Step 4: Verify the form page renders**

```bash
npm run dev &
sleep 3
curl -s http://localhost:3000/migrations/new | grep -o "New Migration"
kill %1
```

Expected: "New Migration" in output.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add new migration form with zod validation and namespace filtering"
```

---

### Task 6: Migration Detail Page with Charts and Logs

**Files:**
- Create: `src/components/metrics-charts.tsx`
- Create: `src/components/logs-panel.tsx`
- Create: `src/app/migrations/[id]/page.tsx`

**Interfaces:**
- Consumes: `GET /api/migrations/[id]`, `GET /api/metrics/[migrationId]`, `GET /api/migrations/[id]/logs`, action routes from Task 3; `StateBadge`, `ActionButtons` from Task 4
- Produces: `/migrations/[id]` detail page with live state, charts, action buttons, and logs

- [ ] **Step 1: Create MetricsCharts component**

Create `src/components/metrics-charts.tsx`:

```tsx
"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { Metric } from "@/lib/types";

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString();
}

function Chart({
  data,
  dataKey,
  label,
  color,
  unit,
}: {
  data: Metric[];
  dataKey: keyof Metric;
  label: string;
  color: string;
  unit?: string;
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">{label}</h3>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="timestamp" tickFormatter={formatTime} tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} unit={unit} />
            <Tooltip labelFormatter={formatTime} />
            <Line
              type="monotone"
              dataKey={dataKey}
              stroke={color}
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function MetricsCharts({ metrics }: { metrics: Metric[] }) {
  if (metrics.length === 0) {
    return <p className="text-sm text-muted-foreground">No metrics data yet.</p>;
  }

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Chart data={metrics} dataKey="progress" label="Progress %" color="#2563eb" unit="%" />
      <Chart data={metrics} dataKey="lagTimeSeconds" label="Lag Time" color="#dc2626" unit="s" />
      <Chart
        data={metrics}
        dataKey="totalEventsApplied"
        label="Events Applied"
        color="#16a34a"
      />
      <Chart
        data={metrics}
        dataKey="estimatedCopiedBytes"
        label="Bytes Copied"
        color="#9333ea"
      />
    </div>
  );
}
```

- [ ] **Step 2: Create LogsPanel component**

Create `src/components/logs-panel.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";

export function LogsPanel({ migrationId }: { migrationId: string }) {
  const [lines, setLines] = useState<string[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        const res = await fetch(`/api/migrations/${migrationId}/logs?lines=200`);
        const data = await res.json();
        setLines(data.lines || []);
      } catch {
        // ignore
      }
    };

    fetchLogs();
    const interval = setInterval(fetchLogs, 5000);
    return () => clearInterval(interval);
  }, [migrationId]);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [lines]);

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">Logs</h3>
      <div
        ref={containerRef}
        className="h-64 overflow-auto rounded-md border bg-black p-3 font-mono text-xs text-green-400"
      >
        {lines.length === 0 ? (
          <p className="text-gray-500">No logs available.</p>
        ) : (
          lines.map((line, i) => (
            <div key={i} className="whitespace-pre-wrap">
              {line}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create the migration detail page**

Create `src/app/migrations/[id]/page.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { StateBadge } from "@/components/state-badge";
import { ActionButtons } from "@/components/action-buttons";
import { MetricsCharts } from "@/components/metrics-charts";
import { LogsPanel } from "@/components/logs-panel";
import type { Migration, Metric } from "@/lib/types";

export default function MigrationDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [migration, setMigration] = useState<Migration | null>(null);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    try {
      const [migRes, metRes] = await Promise.all([
        fetch(`/api/migrations/${params.id}`),
        fetch(`/api/metrics/${params.id}`),
      ]);

      if (!migRes.ok) {
        router.push("/");
        return;
      }

      setMigration(await migRes.json());
      setMetrics(await metRes.json());
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [params.id]);

  if (loading) {
    return <p className="text-muted-foreground">Loading...</p>;
  }

  if (!migration) {
    return <p className="text-muted-foreground">Migration not found.</p>;
  }

  const lastMetric = metrics[metrics.length - 1];
  const progressPercent = lastMetric?.progress ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{migration.name}</h1>
            <StateBadge state={migration.state} />
          </div>
          <p className="text-sm text-muted-foreground">
            {migration.sourceUri} → {migration.destUri}
          </p>
        </div>
        <ActionButtons migration={migration} onAction={fetchData} />
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Progress</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{progressPercent.toFixed(1)}%</div>
            <Progress value={progressPercent} className="mt-2" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Lag Time</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {lastMetric?.lagTimeSeconds != null ? `${lastMetric.lagTimeSeconds}s` : "—"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Events Applied</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {lastMetric?.totalEventsApplied?.toLocaleString() ?? "—"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Bytes Copied</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {lastMetric ? formatBytes(lastMetric.estimatedCopiedBytes) : "—"}
            </div>
            {lastMetric && lastMetric.estimatedTotalBytes > 0 && (
              <p className="text-xs text-muted-foreground">
                of {formatBytes(lastMetric.estimatedTotalBytes)}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <MetricsCharts metrics={metrics} />

      <LogsPanel migrationId={migration.id} />
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}
```

- [ ] **Step 4: Verify the detail page compiles**

```bash
npm run build 2>&1 | tail -10
```

Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add migration detail page with metrics charts and logs panel"
```

---

### Task 7: Settings Page

**Files:**
- Create: `src/app/settings/page.tsx`

**Interfaces:**
- Consumes: `GET /api/settings`, `PUT /api/settings`, `GET /api/mongosync/version` from Task 3
- Produces: `/settings` page with binary path config, version test, poll interval

- [ ] **Step 1: Create the settings page**

Create `src/app/settings/page.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function SettingsPage() {
  const [mongosyncPath, setMongosyncPath] = useState("");
  const [pollInterval, setPollInterval] = useState("5000");
  const [version, setVersion] = useState<string | null>(null);
  const [versionError, setVersionError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((res) => res.json())
      .then((data) => {
        setMongosyncPath(data.mongosyncPath || "");
        setPollInterval(data.pollInterval || "5000");
      })
      .catch(() => {});
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mongosyncPath, pollInterval }),
      });
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  const testBinary = async () => {
    setTesting(true);
    setVersion(null);
    setVersionError(null);
    try {
      const res = await fetch("/api/mongosync/version");
      const data = await res.json();
      if (res.ok) {
        setVersion(data.version);
      } else {
        setVersionError(data.error);
      }
    } catch (err: any) {
      setVersionError(err.message);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-2xl font-bold">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle>Mongosync Binary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="mongosyncPath">Binary Path</Label>
            <div className="flex gap-2">
              <Input
                id="mongosyncPath"
                value={mongosyncPath}
                onChange={(e) => setMongosyncPath(e.target.value)}
                placeholder="mongosync (or full path)"
              />
              <Button variant="outline" onClick={testBinary} disabled={testing}>
                {testing ? "Testing..." : "Test"}
              </Button>
            </div>
            {version && (
              <p className="text-sm text-green-600">Version: {version}</p>
            )}
            {versionError && (
              <p className="text-sm text-red-500">Error: {versionError}</p>
            )}
          </div>

          <a
            href="https://www.mongodb.com/docs/mongosync/current/installation/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-blue-600 hover:underline"
          >
            Download mongosync from MongoDB
          </a>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Polling</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="pollInterval">Poll Interval (ms)</Label>
            <Input
              id="pollInterval"
              type="number"
              value={pollInterval}
              onChange={(e) => setPollInterval(e.target.value)}
              min={1000}
              max={60000}
            />
            <p className="text-xs text-muted-foreground">
              How often to check mongosync progress (default: 5000ms)
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Data Directory</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground font-mono">~/.mongosync-ui/</p>
          <p className="text-xs text-muted-foreground mt-1">
            Contains database, config files, and logs
          </p>
        </CardContent>
      </Card>

      <Button onClick={save} disabled={saving}>
        {saving ? "Saving..." : "Save Settings"}
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Verify the settings page renders**

```bash
npm run build 2>&1 | tail -10
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: add settings page with binary path config and version testing"
```

---

### Task 8: Startup Initialization + Final Integration

**Files:**
- Create: `src/lib/init.ts`
- Modify: `src/app/layout.tsx` (add init call)
- Modify: `src/app/api/migrations/route.ts` (ensure poller starts on GET)

**Interfaces:**
- Consumes: all previous tasks
- Produces: app initializes properly on startup — detects dead processes, starts poller, auto-detects mongosync binary

- [ ] **Step 1: Create init module**

Create `src/lib/init.ts`:

```ts
import { getAllMigrations, updateMigration, getSetting, setSetting } from "./db";
import { isProcessAlive } from "./process-manager";
import { startPoller } from "./poller";
import { execSync } from "node:child_process";

let initialized = false;

export function initApp(): void {
  if (initialized) return;
  initialized = true;

  // Clean up dead processes
  const migrations = getAllMigrations();
  for (const m of migrations) {
    if (m.pid && !isProcessAlive(m.pid)) {
      updateMigration(m.id, { pid: null });
    }
  }

  // Auto-detect mongosync if not set
  if (!getSetting("mongosyncPath")) {
    const candidates = ["/usr/local/bin/mongosync", "/usr/bin/mongosync"];
    for (const candidate of candidates) {
      try {
        execSync(`${candidate} --version`, { timeout: 3000, stdio: "ignore" });
        setSetting("mongosyncPath", candidate);
        break;
      } catch {
        // not found, try next
      }
    }
    // Try PATH
    if (!getSetting("mongosyncPath")) {
      try {
        execSync("mongosync --version", { timeout: 3000, stdio: "ignore" });
        setSetting("mongosyncPath", "mongosync");
      } catch {
        // not found anywhere
      }
    }
  }

  // Start poller
  const interval = Number(getSetting("pollInterval") || "5000");
  startPoller(interval);
}
```

- [ ] **Step 2: Integrate init into the migrations API route**

Modify `src/app/api/migrations/route.ts` — add at the top of the file, before the route handlers:

```ts
import { initApp } from "@/lib/init";

// Initialize on first API call
initApp();
```

Add the same import and call to `src/app/api/migrations/[id]/route.ts`:

```ts
import { initApp } from "@/lib/init";
initApp();
```

- [ ] **Step 3: Final build and verification**

```bash
npm run build
```

Expected: build succeeds with no errors.

```bash
npm run test
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add startup initialization with process cleanup and binary auto-detection"
```

- [ ] **Step 5: Final smoke test**

```bash
npm run dev &
sleep 3
# Test dashboard loads
curl -s http://localhost:3000 | grep -c "Migrations"
# Test API returns empty list
curl -s http://localhost:3000/api/migrations
# Test settings API
curl -s http://localhost:3000/api/settings
# Test new migration page
curl -s http://localhost:3000/migrations/new | grep -c "New Migration"
kill %1
```

Expected: All return valid responses. Dashboard shows "Migrations", API returns `[]`, settings returns JSON, new migration page renders.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "chore: final integration verification"
```
