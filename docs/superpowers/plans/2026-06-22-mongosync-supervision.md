# Mongosync Instance Supervision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make mongosync instances fault-tolerant — surviving process crash, hang, server restart, and machine reboot — via a tmux session + respawn wrapper per migration, an upgraded in-app health monitor, and an optional OS boot service.

**Architecture:** Each migration runs in a tmux session (`msync-<id>`) executing a respawn wrapper that relaunches mongosync on exit with backoff and a crash-loop cap. The Next.js app's poller becomes a health monitor that reconciles desired-vs-actual state, detects hung processes (API unreachable while the process is alive), and re-drives the mongosync API so a respawned binary resumes. An optional systemd-user / launchd unit starts the app at boot so reconciliation rebuilds sessions. Process identity is the deterministic session name plus a `/progress` handshake — never a raw PID.

**Tech Stack:** Next.js 16 (App Router) · TypeScript · better-sqlite3 · tmux (CLI) · bash (wrapper script) · Vitest.

## Global Constraints

- **Cross-platform core:** the tmux + wrapper + monitor path must run identically on Linux and macOS. Only `os-unit.ts` (boot service) may branch on `process.platform`.
- **tmux is the supervised-mode dependency.** When tmux is absent, fall back to today's detached `spawn` and mark the migration `unsupervised` — never hard-fail.
- **Warn, don't kill, on ambiguity.** Auto-restart only on unambiguous failure (process gone, or API unreachable for ≥ `hungTicks`). A *reachable but slow* migration produces a warning, never an auto-kill.
- **Identity = `msync-<id>` session name + `/progress` handshake.** `pid` is informational only.
- **Intentional-stop ordering, always:** set `desired_running=0` → write `stop` sentinel → `tmux kill-session`. Reconcile is idempotent and finishes any half-done teardown.
- **Default thresholds:** backoff cap 60s; crash-loop cap 5 exits / 300s window; hung = 6 consecutive unreachable ticks (~30s at 5s poll). All overridable via settings.
- **Default `supervisionMode` = `supervised`.**
- Follow existing `src/lib` conventions: small focused modules, `@/` import alias, functions over classes, tests under `src/lib/__tests__/` using `process.env.MONGOSYNC_UI_DIR` + `vi.resetModules()`.

## File Structure

**Create:**
- `src/lib/supervision-config.ts` — reads supervision thresholds/mode from settings with defaults.
- `src/lib/tmux.ts` — thin tmux CLI wrapper (mockable, no business logic).
- `scripts/mongosync-respawn.sh` — the respawn wrapper run inside each tmux session.
- `src/lib/supervisor.ts` — orchestration: paths, wrapper command, start/stop, status read, `reconcile()`.
- `src/lib/os-unit.ts` — generate + install/uninstall systemd-user unit (Linux) / launchd plist (macOS).
- `scripts/supervisor-cli.mjs` — CLI entry for `supervisor:install` / `:uninstall`.
- `src/lib/__tests__/fixtures/fake-mongosync.sh` — controllable fake binary for fault injection.
- Tests: `supervision-config.test.ts`, `tmux.test.ts`, `supervisor.test.ts`, `health-monitor.test.ts`, `os-unit.test.ts`, `supervision.integration.test.ts`.

**Modify:**
- `src/lib/types.ts` — add supervision fields + shared types.
- `src/lib/db.ts` — additive `ALTER TABLE` schema migration + supervision field defaults.
- `src/lib/process-manager.ts` — reroute `spawnMongosync`/`killMongosync` through the supervisor; tmux fallback.
- `src/lib/poller.ts` — health monitor (reconcile + hung detection + resume + status read).
- `src/lib/init.ts` — startup reconcile rebuilds sessions.
- API routes under `src/app/api/migrations/...` — intentional-stop ordering + desired_running.
- `src/app/api/settings/route.ts` + `src/app/settings/page.tsx` — supervision settings + boot-service panel.
- `src/app/api/supervision/route.ts` (new) — boot-service install status/actions.
- `package.json` — npm scripts.
- `CLAUDE.md`, `README.md` — document the new model.

---

### Task 1: Supervision types

**Files:**
- Modify: `src/lib/types.ts`
- Test: `src/lib/__tests__/supervision-config.test.ts` (created in Task 2; this task adds no test of its own — it is pure type additions consumed by Task 2's test)

**Interfaces:**
- Produces:
  - `SupervisionStatus = "running" | "restarting" | "crash_looping" | "stopped" | "unsupervised"`
  - `Migration` gains: `desiredRunning: number` (0/1), `supervisionStatus: SupervisionStatus`, `restartCount: number`, `lastExitCode: number | null`, `lastRestartAt: number | null`
  - `WrapperStatus { attempt: number; lastExitCode: number | null; lastStartAt: number; state: "running" | "crash_looping" }`
  - `SupervisionConfig { mode: "supervised" | "legacy"; backoffCapSec: number; crashLoopMax: number; crashLoopWindowSec: number; hungTicks: number }`

- [ ] **Step 1: Add the types**

In `src/lib/types.ts`, add after the `MongosyncState` definitions:

```typescript
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
```

Then extend the `Migration` interface (add the fields; keep existing ones):

```typescript
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
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: errors only in `db.ts` (missing fields on insert) — those are fixed in Task 3. No errors in `types.ts` itself.

- [ ] **Step 3: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat(types): add supervision fields and shared supervision types"
```

---

### Task 2: Supervision config from settings

**Files:**
- Create: `src/lib/supervision-config.ts`
- Test: `src/lib/__tests__/supervision-config.test.ts`

**Interfaces:**
- Consumes: `getSetting` from `db.ts`; `SupervisionConfig` from `types.ts`.
- Produces: `getSupervisionConfig(): SupervisionConfig`.

- [ ] **Step 1: Write the failing test**

`src/lib/__tests__/supervision-config.test.ts`:

```typescript
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

describe("getSupervisionConfig", () => {
  it("returns defaults when nothing is set", async () => {
    const { getSupervisionConfig } = await import("@/lib/supervision-config");
    expect(getSupervisionConfig()).toEqual({
      mode: "supervised",
      backoffCapSec: 60,
      crashLoopMax: 5,
      crashLoopWindowSec: 300,
      hungTicks: 6,
    });
  });

  it("reads overrides from settings and clamps invalid numbers to defaults", async () => {
    const { setSetting } = await import("@/lib/db");
    setSetting("supervisionMode", "legacy");
    setSetting("backoffCapSec", "30");
    setSetting("hungTicks", "not-a-number");
    const { getSupervisionConfig } = await import("@/lib/supervision-config");
    const cfg = getSupervisionConfig();
    expect(cfg.mode).toBe("legacy");
    expect(cfg.backoffCapSec).toBe(30);
    expect(cfg.hungTicks).toBe(6); // invalid → default
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/supervision-config.test.ts`
Expected: FAIL — cannot find module `@/lib/supervision-config`.

- [ ] **Step 3: Write the implementation**

`src/lib/supervision-config.ts`:

```typescript
import { getSetting } from "./db";
import type { SupervisionConfig } from "./types";

function num(key: string, fallback: number): number {
  const raw = getSetting(key);
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function getSupervisionConfig(): SupervisionConfig {
  return {
    mode: getSetting("supervisionMode") === "legacy" ? "legacy" : "supervised",
    backoffCapSec: num("backoffCapSec", 60),
    crashLoopMax: num("crashLoopMax", 5),
    crashLoopWindowSec: num("crashLoopWindowSec", 300),
    hungTicks: num("hungTicks", 6),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/supervision-config.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/supervision-config.ts src/lib/__tests__/supervision-config.test.ts
git commit -m "feat(supervision): read supervision config from settings with defaults"
```

---

### Task 3: Schema migration + supervision field persistence

**Files:**
- Modify: `src/lib/db.ts`
- Test: `src/lib/__tests__/db.test.ts` (add cases)

**Interfaces:**
- Consumes: `Migration` (extended), `SupervisionStatus` from `types.ts`.
- Produces: `migrations` table with new columns; `createMigration` populates supervision defaults; `updateMigration` accepts the new fields (already generic).

- [ ] **Step 1: Write the failing test**

Append to `src/lib/__tests__/db.test.ts` inside the `describe("db", ...)` block:

```typescript
  it("creates migrations with supervision defaults", async () => {
    const { createMigration } = await loadDb();
    const m = createMigration({
      name: "m", sourceUri: "mongodb://a", destUri: "mongodb://b", config: {}, port: 27182,
    });
    expect(m.desiredRunning).toBe(0);
    expect(m.supervisionStatus).toBe("stopped");
    expect(m.restartCount).toBe(0);
    expect(m.lastExitCode).toBeNull();
    expect(m.lastRestartAt).toBeNull();
  });

  it("persists supervision field updates", async () => {
    const { createMigration, updateMigration, getMigration } = await loadDb();
    const m = createMigration({
      name: "m", sourceUri: "mongodb://a", destUri: "mongodb://b", config: {}, port: 27182,
    });
    updateMigration(m.id, { desiredRunning: 1, supervisionStatus: "running", restartCount: 2, lastExitCode: 9 });
    const u = getMigration(m.id)!;
    expect(u.desiredRunning).toBe(1);
    expect(u.supervisionStatus).toBe("running");
    expect(u.restartCount).toBe(2);
    expect(u.lastExitCode).toBe(9);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/db.test.ts`
Expected: FAIL — `desiredRunning` is `undefined` (column/field missing).

- [ ] **Step 3: Add the schema migration helper**

In `src/lib/db.ts`, inside `getDb()` after the `db.exec(...)` create-table block and before `return db;`, add a call:

```typescript
  migrateSchema(db);
```

Then add this function below `getDb()`:

```typescript
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
}
```

- [ ] **Step 4: Populate defaults in `createMigration`**

In `createMigration`, extend the `migration` object literal and the INSERT to include the new fields:

```typescript
  const migration: Migration = {
    id: nanoid(),
    name: input.name,
    sourceUri: input.sourceUri,
    destUri: input.destUri,
    config: JSON.stringify(input.config),
    state: "IDLE",
    port: input.port,
    pid: null,
    desiredRunning: 0,
    supervisionStatus: "stopped",
    restartCount: 0,
    lastExitCode: null,
    lastRestartAt: null,
    createdAt: now,
    updatedAt: now,
  };
  getDb()
    .prepare(
      `INSERT INTO migrations (id, name, sourceUri, destUri, config, state, port, pid,
         desiredRunning, supervisionStatus, restartCount, lastExitCode, lastRestartAt, createdAt, updatedAt)
       VALUES (@id, @name, @sourceUri, @destUri, @config, @state, @port, @pid,
         @desiredRunning, @supervisionStatus, @restartCount, @lastExitCode, @lastRestartAt, @createdAt, @updatedAt)`
    )
    .run(migration);
  return migration;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/db.test.ts && npx tsc --noEmit`
Expected: PASS; `tsc` clean (Task 1 type errors now resolved).

- [ ] **Step 6: Commit**

```bash
git add src/lib/db.ts src/lib/__tests__/db.test.ts
git commit -m "feat(db): additive schema migration for supervision fields"
```

---

### Task 4: tmux CLI wrapper

**Files:**
- Create: `src/lib/tmux.ts`
- Test: `src/lib/__tests__/tmux.test.ts`

**Interfaces:**
- Produces:
  - `hasTmux(): boolean`
  - `sessionName(id: string): string` → `msync-<id>`
  - `sessionExists(name: string): boolean`
  - `startSession(name: string, command: string): void`
  - `killSession(name: string): void`
  - `listMsyncSessions(): string[]`
- Consumes: nothing (pure shell-out). Internally uses `node:child_process.spawnSync`.

- [ ] **Step 1: Write the failing test** (mocks `child_process`)

`src/lib/__tests__/tmux.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const spawnSync = vi.fn();
vi.mock("node:child_process", () => ({ spawnSync: (...a: unknown[]) => spawnSync(...a) }));

async function load() {
  vi.resetModules();
  return await import("@/lib/tmux");
}

beforeEach(() => spawnSync.mockReset());

describe("tmux wrapper", () => {
  it("derives a session name from a migration id", async () => {
    const { sessionName } = await load();
    expect(sessionName("abc123")).toBe("msync-abc123");
  });

  it("sessionExists reflects tmux has-session exit code", async () => {
    spawnSync.mockReturnValue({ status: 0 });
    const { sessionExists } = await load();
    expect(sessionExists("msync-x")).toBe(true);
    expect(spawnSync).toHaveBeenCalledWith("tmux", ["has-session", "-t", "msync-x"], expect.anything());

    spawnSync.mockReturnValue({ status: 1 });
    expect(sessionExists("msync-x")).toBe(false);
  });

  it("startSession launches a detached session running the command", async () => {
    spawnSync.mockReturnValue({ status: 0 });
    const { startSession } = await load();
    startSession("msync-x", "/path/wrapper.sh arg1");
    expect(spawnSync).toHaveBeenCalledWith(
      "tmux",
      ["new-session", "-d", "-s", "msync-x", "/path/wrapper.sh arg1"],
      expect.anything()
    );
  });

  it("listMsyncSessions returns only msync-* names", async () => {
    spawnSync.mockReturnValue({ status: 0, stdout: "msync-a\nmsync-b\nother\n" });
    const { listMsyncSessions } = await load();
    expect(listMsyncSessions()).toEqual(["msync-a", "msync-b"]);
  });

  it("hasTmux is false when tmux is not found", async () => {
    spawnSync.mockReturnValue({ status: null, error: new Error("ENOENT") });
    const { hasTmux } = await load();
    expect(hasTmux()).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/tmux.test.ts`
Expected: FAIL — cannot find module `@/lib/tmux`.

- [ ] **Step 3: Write the implementation**

`src/lib/tmux.ts`:

```typescript
import { spawnSync } from "node:child_process";

function tmux(args: string[]): { status: number | null; stdout: string; error?: Error } {
  const res = spawnSync("tmux", args, { encoding: "utf-8" });
  return { status: res.status, stdout: res.stdout ?? "", error: res.error };
}

export function hasTmux(): boolean {
  const res = tmux(["-V"]);
  return !res.error && res.status === 0;
}

export function sessionName(id: string): string {
  return `msync-${id}`;
}

export function sessionExists(name: string): boolean {
  return tmux(["has-session", "-t", name]).status === 0;
}

export function startSession(name: string, command: string): void {
  const res = tmux(["new-session", "-d", "-s", name, command]);
  if (res.status !== 0) {
    throw new Error(`tmux failed to start session ${name}${res.error ? `: ${res.error.message}` : ""}`);
  }
}

export function killSession(name: string): void {
  tmux(["kill-session", "-t", name]); // ignore status — absent session is fine
}

export function listMsyncSessions(): string[] {
  const res = tmux(["list-sessions", "-F", "#{session_name}"]);
  if (res.status !== 0) return [];
  return res.stdout
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.startsWith("msync-"));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/tmux.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/tmux.ts src/lib/__tests__/tmux.test.ts
git commit -m "feat(tmux): add mockable tmux CLI wrapper"
```

---

### Task 5: Respawn wrapper script

**Files:**
- Create: `scripts/mongosync-respawn.sh`
- Test: `src/lib/__tests__/supervision.integration.test.ts` (new — script behavior is shell, tested by running it)

**Interfaces:**
- Produces: a script invoked as
  `mongosync-respawn.sh <bin> <configPath> <logDir> <statusFile> <stopSentinel> <backoffCapSec> <crashLoopMax> <crashLoopWindowSec>`
  that writes a JSON `WrapperStatus` line to `<statusFile>` and respawns `<bin> --config <configPath>` until the stop sentinel appears or the crash-loop cap trips.

- [ ] **Step 1: Write the failing test**

`src/lib/__tests__/supervision.integration.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import path from "path";
import fs from "fs";
import os from "os";

const SCRIPT = path.resolve(__dirname, "../../../scripts/mongosync-respawn.sh");
let dir: string;

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "wrap-")); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

// A "binary" that exits immediately with code 7 — forces the crash-loop path fast.
function crashingBin(): string {
  const p = path.join(dir, "crash.sh");
  fs.writeFileSync(p, "#!/usr/bin/env bash\nexit 7\n");
  fs.chmodSync(p, 0o755);
  return p;
}

describe("mongosync-respawn.sh", () => {
  it("stops at the crash-loop cap and records crash_looping with the last exit code", () => {
    const status = path.join(dir, "status.json");
    const stop = path.join(dir, "stop");
    // cap=3, window=300, backoffCap=0 so retries are immediate
    const res = spawnSync(
      "bash",
      [SCRIPT, crashingBin(), path.join(dir, "cfg.yaml"), dir, status, stop, "0", "3", "300"],
      { encoding: "utf-8", timeout: 15000 }
    );
    expect(res.status).toBe(0);
    const parsed = JSON.parse(fs.readFileSync(status, "utf-8").trim().split("\n").pop()!);
    expect(parsed.state).toBe("crash_looping");
    expect(parsed.lastExitCode).toBe(7);
    expect(parsed.attempt).toBeGreaterThanOrEqual(3);
  });

  it("exits cleanly without respawning when the stop sentinel exists at start", () => {
    const status = path.join(dir, "status.json");
    const stop = path.join(dir, "stop");
    fs.writeFileSync(stop, "");
    const res = spawnSync(
      "bash",
      [SCRIPT, crashingBin(), path.join(dir, "cfg.yaml"), dir, status, stop, "0", "3", "300"],
      { encoding: "utf-8", timeout: 5000 }
    );
    expect(res.status).toBe(0);
    expect(fs.existsSync(stop)).toBe(false); // sentinel consumed
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/supervision.integration.test.ts`
Expected: FAIL — script file does not exist (`bash` reports "No such file or directory").

- [ ] **Step 3: Write the script**

`scripts/mongosync-respawn.sh`:

```bash
#!/usr/bin/env bash
# Keeps a mongosync process alive with backoff and a crash-loop cap.
# Args: <bin> <configPath> <logDir> <statusFile> <stopSentinel> <backoffCapSec> <crashLoopMax> <crashLoopWindowSec>
set -u

BIN="$1"; CONFIG="$2"; LOGDIR="$3"; STATUS="$4"; STOP="$5"
BACKOFF_CAP="${6:-60}"; CRASH_MAX="${7:-5}"; CRASH_WINDOW="${8:-300}"

attempt=0
backoff=2
window_start=$(date +%s)
window_count=0

write_status() { # $1=state $2=lastExitCode(JSON number or null)
  printf '{"attempt":%d,"lastExitCode":%s,"lastStartAt":%d,"state":"%s"}\n' \
    "$attempt" "$2" "$(date +%s)" "$1" > "$STATUS"
}

while true; do
  if [ -f "$STOP" ]; then rm -f "$STOP"; break; fi
  attempt=$((attempt + 1))
  write_status "running" "null"
  # 2>&1 | tee keeps output visible in `tmux attach` AND persisted for the logs panel.
  "$BIN" --config "$CONFIG" 2>&1 | tee -a "$LOGDIR/stdout.log"
  code=${PIPESTATUS[0]}
  write_status "running" "$code"
  if [ -f "$STOP" ]; then rm -f "$STOP"; break; fi

  now=$(date +%s)
  if [ $((now - window_start)) -gt "$CRASH_WINDOW" ]; then
    window_start=$now; window_count=0
  fi
  window_count=$((window_count + 1))
  if [ "$window_count" -ge "$CRASH_MAX" ]; then
    write_status "crash_looping" "$code"
    break
  fi

  sleep "$backoff"
  backoff=$((backoff * 2))
  if [ "$backoff" -gt "$BACKOFF_CAP" ]; then backoff="$BACKOFF_CAP"; fi
done
```

- [ ] **Step 4: Make it executable and run the test**

```bash
chmod +x scripts/mongosync-respawn.sh
npx vitest run src/lib/__tests__/supervision.integration.test.ts
```
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add scripts/mongosync-respawn.sh src/lib/__tests__/supervision.integration.test.ts
git commit -m "feat(supervision): respawn wrapper with backoff and crash-loop cap"
```

---

### Task 6: Supervisor orchestration + reconcile

**Files:**
- Create: `src/lib/supervisor.ts`
- Test: `src/lib/__tests__/supervisor.test.ts`

**Interfaces:**
- Consumes: `tmux.ts` (`sessionName`, `sessionExists`, `startSession`, `killSession`, `listMsyncSessions`); `db.ts` (`getAllMigrations`, `getMigration`, `updateMigration`); `generateConfig` from `config-generator.ts`; `resolveMongosyncBin` from `process-manager.ts`; `getLogDir`, `getDataDir` from `paths.ts`; `getSupervisionConfig`; `WrapperStatus` type.
- Produces:
  - `statusPath(id): string`, `stopSentinelPath(id): string`
  - `buildWrapperCommand(migration): string`
  - `superviseStart(migration): void`
  - `superviseStop(id, opts?: { intentional?: boolean }): void`
  - `readWrapperStatus(id): WrapperStatus | null`
  - `reconcile(): void`

- [ ] **Step 1: Write the failing test** (mock tmux, config-generator, process-manager)

`src/lib/__tests__/supervisor.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "path";
import fs from "fs";
import os from "os";

const tmux = {
  sessionName: (id: string) => `msync-${id}`,
  sessionExists: vi.fn(),
  startSession: vi.fn(),
  killSession: vi.fn(),
  listMsyncSessions: vi.fn(() => [] as string[]),
};
vi.mock("@/lib/tmux", () => tmux);
vi.mock("@/lib/config-generator", () => ({ generateConfig: () => "/tmp/cfg.yaml" }));
vi.mock("@/lib/process-manager", () => ({ resolveMongosyncBin: () => "/usr/bin/mongosync" }));

let testDir: string;
let originalEnv: string | undefined;

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), "mongosync-ui-test-"));
  originalEnv = process.env.MONGOSYNC_UI_DIR;
  process.env.MONGOSYNC_UI_DIR = testDir;
  vi.resetModules();
  Object.values(tmux).forEach((f) => typeof f === "function" && (f as ReturnType<typeof vi.fn>).mockReset?.());
  tmux.sessionName = (id: string) => `msync-${id}`;
  tmux.listMsyncSessions.mockReturnValue([]);
});
afterEach(() => {
  process.env.MONGOSYNC_UI_DIR = originalEnv;
  fs.rmSync(testDir, { recursive: true, force: true });
});

async function setup() {
  const db = await import("@/lib/db");
  const sup = await import("@/lib/supervisor");
  return { db, sup };
}

describe("supervisor", () => {
  it("superviseStart sets desiredRunning and starts a session when none exists", async () => {
    const { db, sup } = await setup();
    const m = db.createMigration({ name: "m", sourceUri: "mongodb://a", destUri: "mongodb://b", config: {}, port: 27182 });
    tmux.sessionExists.mockReturnValue(false);
    sup.superviseStart(db.getMigration(m.id)!);
    expect(tmux.startSession).toHaveBeenCalledWith(`msync-${m.id}`, expect.stringContaining("mongosync-respawn.sh"));
    expect(db.getMigration(m.id)!.desiredRunning).toBe(1);
    expect(db.getMigration(m.id)!.supervisionStatus).toBe("running");
  });

  it("superviseStop(intentional) writes the stop sentinel before killing the session", async () => {
    const { db, sup } = await setup();
    const m = db.createMigration({ name: "m", sourceUri: "mongodb://a", destUri: "mongodb://b", config: {}, port: 27182 });
    db.updateMigration(m.id, { desiredRunning: 1 });
    sup.superviseStop(m.id, { intentional: true });
    expect(fs.existsSync(sup.stopSentinelPath(m.id))).toBe(true);
    expect(tmux.killSession).toHaveBeenCalledWith(`msync-${m.id}`);
    expect(db.getMigration(m.id)!.desiredRunning).toBe(0);
    expect(db.getMigration(m.id)!.supervisionStatus).toBe("stopped");
  });

  it("reconcile recreates a missing session for a desired-running migration", async () => {
    const { db, sup } = await setup();
    const m = db.createMigration({ name: "m", sourceUri: "mongodb://a", destUri: "mongodb://b", config: {}, port: 27182 });
    db.updateMigration(m.id, { desiredRunning: 1 });
    tmux.sessionExists.mockReturnValue(false);
    sup.reconcile();
    expect(tmux.startSession).toHaveBeenCalled();
    expect(db.getMigration(m.id)!.supervisionStatus).toBe("restarting");
  });

  it("reconcile marks crash_looping and kills the session when the wrapper gave up", async () => {
    const { db, sup } = await setup();
    const m = db.createMigration({ name: "m", sourceUri: "mongodb://a", destUri: "mongodb://b", config: {}, port: 27182 });
    db.updateMigration(m.id, { desiredRunning: 1 });
    fs.writeFileSync(sup.statusPath(m.id), JSON.stringify({ attempt: 5, lastExitCode: 7, lastStartAt: 1, state: "crash_looping" }));
    tmux.sessionExists.mockReturnValue(true);
    sup.reconcile();
    expect(db.getMigration(m.id)!.supervisionStatus).toBe("crash_looping");
    expect(db.getMigration(m.id)!.lastExitCode).toBe(7);
    expect(tmux.killSession).toHaveBeenCalledWith(`msync-${m.id}`);
  });

  it("reconcile kills sessions for migrations that should not be running", async () => {
    const { db, sup } = await setup();
    const m = db.createMigration({ name: "m", sourceUri: "mongodb://a", destUri: "mongodb://b", config: {}, port: 27182 });
    // desiredRunning defaults to 0
    tmux.sessionExists.mockReturnValue(true);
    sup.reconcile();
    expect(tmux.killSession).toHaveBeenCalledWith(`msync-${m.id}`);
  });

  it("reconcile sweeps orphan msync sessions with no matching migration", async () => {
    const { sup } = await setup();
    tmux.listMsyncSessions.mockReturnValue(["msync-ghost"]);
    tmux.sessionExists.mockReturnValue(false);
    sup.reconcile();
    expect(tmux.killSession).toHaveBeenCalledWith("msync-ghost");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/supervisor.test.ts`
Expected: FAIL — cannot find module `@/lib/supervisor`.

- [ ] **Step 3: Write the implementation**

`src/lib/supervisor.ts`:

```typescript
import path from "path";
import fs from "fs";
import { getAllMigrations, getMigration, updateMigration } from "./db";
import { generateConfig } from "./config-generator";
import { resolveMongosyncBin } from "./process-manager";
import { getLogDir, getDataDir } from "./paths";
import { getSupervisionConfig } from "./supervision-config";
import { sessionName, sessionExists, startSession, killSession, listMsyncSessions } from "./tmux";
import type { Migration, WrapperStatus } from "./types";

const WRAPPER = path.resolve(process.cwd(), "scripts/mongosync-respawn.sh");

function supervisionDir(id: string): string {
  const dir = path.join(getDataDir(), "supervision", id);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function statusPath(id: string): string {
  return path.join(supervisionDir(id), "status.json");
}

export function stopSentinelPath(id: string): string {
  return path.join(supervisionDir(id), "stop");
}

// Minimal POSIX single-quote escaping so paths with spaces survive tmux's shell.
function q(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

export function buildWrapperCommand(migration: Migration): string {
  const bin = resolveMongosyncBin();
  const config = generateConfig(migration);
  const logDir = getLogDir(migration.id);
  const cfg = getSupervisionConfig();
  return [
    q(WRAPPER), q(bin), q(config), q(logDir),
    q(statusPath(migration.id)), q(stopSentinelPath(migration.id)),
    cfg.backoffCapSec, cfg.crashLoopMax, cfg.crashLoopWindowSec,
  ].join(" ");
}

export function readWrapperStatus(id: string): WrapperStatus | null {
  try {
    const raw = fs.readFileSync(statusPath(id), "utf-8").trim();
    if (!raw) return null;
    const last = raw.split("\n").pop()!;
    return JSON.parse(last) as WrapperStatus;
  } catch {
    return null;
  }
}

export function superviseStart(migration: Migration): void {
  const name = sessionName(migration.id);
  // Clear any stale stop sentinel so the wrapper does not immediately exit.
  fs.rmSync(stopSentinelPath(migration.id), { force: true });
  if (!sessionExists(name)) startSession(name, buildWrapperCommand(migration));
  updateMigration(migration.id, { desiredRunning: 1, supervisionStatus: "running" });
}

export function superviseStop(id: string, opts: { intentional?: boolean } = {}): void {
  const name = sessionName(id);
  if (opts.intentional !== false) {
    // Order matters: intent → sentinel → kill. A crash mid-way self-heals via reconcile.
    updateMigration(id, { desiredRunning: 0 });
    fs.writeFileSync(stopSentinelPath(id), "");
  }
  killSession(name);
  updateMigration(id, { supervisionStatus: "stopped" });
}

// Idempotent: drive every migration toward its desired state. Safe to call repeatedly
// (each poll tick, on startup, after reboot). This is the single recovery path.
export function reconcile(): void {
  const migrations = getAllMigrations();
  const known = new Set(migrations.map((m) => sessionName(m.id)));

  for (const m of migrations) {
    const name = sessionName(m.id);
    if (m.desiredRunning) {
      const status = readWrapperStatus(m.id);
      if (status?.state === "crash_looping") {
        updateMigration(m.id, {
          supervisionStatus: "crash_looping",
          restartCount: status.attempt,
          lastExitCode: status.lastExitCode,
        });
        killSession(name);
        continue;
      }
      if (!sessionExists(name)) {
        const fresh = getMigration(m.id);
        if (fresh) superviseStart(fresh);
        updateMigration(m.id, { supervisionStatus: "restarting", lastRestartAt: Date.now() });
      } else if (m.supervisionStatus !== "running") {
        updateMigration(m.id, { supervisionStatus: "running" });
      }
    } else if (sessionExists(name)) {
      killSession(name);
      updateMigration(m.id, { supervisionStatus: "stopped" });
    }
  }

  // Sweep orphan sessions whose migration row is gone (e.g. deleted while app was down).
  for (const s of listMsyncSessions()) {
    if (!known.has(s)) killSession(s);
  }
}
```

> Note: `reconcile` reuses the in-memory `m.desiredRunning` snapshot; `superviseStart` re-reads via `getMigration` to write fresh state. The orphan sweep compares against the migration set captured at the top of the call.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/supervisor.test.ts`
Expected: PASS (all six cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/supervisor.ts src/lib/__tests__/supervisor.test.ts
git commit -m "feat(supervisor): orchestration, stop ordering, and idempotent reconcile"
```

---

### Task 7: Health classifier (hung detection)

**Files:**
- Create: `src/lib/health-monitor.ts`
- Test: `src/lib/__tests__/health-monitor.test.ts`

**Interfaces:**
- Produces:
  - `type ProbeResult = "reachable" | "unreachable"`
  - `classifyTick(prevConsecutiveUnreachable: number, probe: ProbeResult, hungTicks: number): { consecutive: number; action: "none" | "restart" }`
  - This is a pure function so the policy is unit-testable in isolation; the poller (Task 8) holds the per-migration counter and acts on `action`.

- [ ] **Step 1: Write the failing test**

`src/lib/__tests__/health-monitor.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { classifyTick } from "@/lib/health-monitor";

describe("classifyTick", () => {
  it("resets the counter and takes no action when reachable", () => {
    expect(classifyTick(5, "reachable", 6)).toEqual({ consecutive: 0, action: "none" });
  });

  it("increments the counter while below the hung threshold", () => {
    expect(classifyTick(0, "unreachable", 6)).toEqual({ consecutive: 1, action: "none" });
    expect(classifyTick(4, "unreachable", 6)).toEqual({ consecutive: 5, action: "none" });
  });

  it("signals restart exactly when consecutive unreachable hits the threshold", () => {
    expect(classifyTick(5, "unreachable", 6)).toEqual({ consecutive: 6, action: "restart" });
  });

  it("keeps signalling restart while still unreachable past the threshold", () => {
    expect(classifyTick(6, "unreachable", 6)).toEqual({ consecutive: 7, action: "restart" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/health-monitor.test.ts`
Expected: FAIL — cannot find module `@/lib/health-monitor`.

- [ ] **Step 3: Write the implementation**

`src/lib/health-monitor.ts`:

```typescript
export type ProbeResult = "reachable" | "unreachable";

// Pure hung-detection policy. The caller owns the per-migration counter.
// A migration is "hung" only when the process/session is alive but /progress has
// been unreachable for `hungTicks` consecutive polls. Slow-but-reachable never trips this.
export function classifyTick(
  prevConsecutiveUnreachable: number,
  probe: ProbeResult,
  hungTicks: number
): { consecutive: number; action: "none" | "restart" } {
  if (probe === "reachable") return { consecutive: 0, action: "none" };
  const consecutive = prevConsecutiveUnreachable + 1;
  return { consecutive, action: consecutive >= hungTicks ? "restart" : "none" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/health-monitor.test.ts`
Expected: PASS (all four cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/health-monitor.ts src/lib/__tests__/health-monitor.test.ts
git commit -m "feat(supervision): pure hung-detection classifier"
```

---

### Task 8: Wire health monitor into the poller

**Files:**
- Modify: `src/lib/poller.ts`
- Test: `src/lib/__tests__/poller.test.ts` (extend if present; otherwise create)

**Interfaces:**
- Consumes: `reconcile`, `readWrapperStatus`, `superviseStart`, `stopSentinelPath` from `supervisor.ts`; `sessionName`, `sessionExists`, `killSession` from `tmux.ts`; `classifyTick` from `health-monitor.ts`; `getSupervisionConfig`; existing `fetchProgress`, `sendCommand` from `process-manager.ts`; `buildStartBody` from `config-generator.ts`.
- Produces: `pollOnce()` now (1) calls `reconcile()`, (2) probes `/progress` and applies hung detection, (3) re-issues `/start` when a supervised migration comes up `IDLE`/`INITIALIZING` (resume).

> **Verification step before coding (resume semantics):** confirm how a relaunched mongosync re-enters an in-progress migration. The MongoDB mongosync docs state a restarted instance with persisted destination state resumes when `/start` is re-issued with the same parameters. If your installed mongosync version differs, adjust only the resume branch below. Record the finding in a comment.

- [ ] **Step 1: Write the failing test**

Create/extend `src/lib/__tests__/poller.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "path";
import fs from "fs";
import os from "os";

const supervisor = { reconcile: vi.fn(), readWrapperStatus: vi.fn(() => null) };
const tmux = { sessionName: (id: string) => `msync-${id}`, sessionExists: vi.fn(() => true), killSession: vi.fn() };
const pm = { fetchProgress: vi.fn(), sendCommand: vi.fn(), isProcessAlive: vi.fn(() => true) };

vi.mock("@/lib/supervisor", () => supervisor);
vi.mock("@/lib/tmux", () => tmux);
vi.mock("@/lib/process-manager", () => pm);
vi.mock("@/lib/config-generator", () => ({ buildStartBody: () => ({ source: "cluster0", destination: "cluster1" }) }));

let dir: string, prevEnv: string | undefined;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mongosync-ui-test-"));
  prevEnv = process.env.MONGOSYNC_UI_DIR; process.env.MONGOSYNC_UI_DIR = dir;
  vi.resetModules();
  [supervisor.reconcile, pm.fetchProgress, pm.sendCommand, tmux.killSession].forEach((f) => f.mockReset());
  tmux.sessionExists.mockReturnValue(true);
});
afterEach(() => { process.env.MONGOSYNC_UI_DIR = prevEnv; fs.rmSync(dir, { recursive: true, force: true }); });

async function withRunningMigration() {
  const db = await import("@/lib/db");
  const m = db.createMigration({ name: "m", sourceUri: "mongodb://a", destUri: "mongodb://b", config: {}, port: 27182 });
  db.updateMigration(m.id, { state: "RUNNING", desiredRunning: 1 });
  return { db, id: m.id };
}

describe("pollOnce health monitoring", () => {
  it("always reconciles first", async () => {
    await withRunningMigration();
    pm.fetchProgress.mockResolvedValue({ success: true, progress: { state: "RUNNING", canCommit: false, canWrite: false } });
    const { pollOnce } = await import("@/lib/poller");
    await pollOnce();
    expect(supervisor.reconcile).toHaveBeenCalled();
  });

  it("restarts a hung migration after hungTicks unreachable probes", async () => {
    const { id } = await withRunningMigration();
    pm.fetchProgress.mockRejectedValue(new Error("ECONNREFUSED"));
    const { pollOnce } = await import("@/lib/poller");
    for (let i = 0; i < 6; i++) await pollOnce(); // default hungTicks = 6
    expect(tmux.killSession).toHaveBeenCalledWith(`msync-${id}`);
  });

  it("re-issues /start when a supervised migration comes up IDLE (resume)", async () => {
    await withRunningMigration();
    pm.fetchProgress.mockResolvedValue({ success: true, progress: { state: "IDLE", canCommit: false, canWrite: false } });
    const { pollOnce } = await import("@/lib/poller");
    await pollOnce();
    expect(pm.sendCommand).toHaveBeenCalledWith(27182, "start", expect.anything());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/poller.test.ts`
Expected: FAIL — current `pollOnce` neither calls `reconcile` nor restarts/resumes.

- [ ] **Step 3: Rewrite `poller.ts`**

Replace the body of `src/lib/poller.ts` with:

```typescript
import { getAllMigrations, updateMigration, insertMetric } from "./db";
import { fetchProgress, sendCommand } from "./process-manager";
import type { ProgressResponse } from "./process-manager";
import { reconcile } from "./supervisor";
import { sessionName, sessionExists, killSession } from "./tmux";
import { classifyTick } from "./health-monitor";
import { getSupervisionConfig } from "./supervision-config";
import { buildStartBody } from "./config-generator";
import type { MetricInput, MongosyncState, Migration } from "./types";

let intervalId: ReturnType<typeof setInterval> | null = null;

// States where mongosync is actively reporting progress worth recording.
const ACTIVE_STATES = ["RUNNING", "COMMITTING", "REVERSING", "PAUSED"];
// States a supervised, freshly-respawned binary shows before we re-drive /start.
const RESUME_STATES = ["IDLE", "INITIALIZING"];

// Per-migration count of consecutive unreachable /progress probes (in-memory).
const unreachable = new Map<string, number>();

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

async function probe(m: Migration, hungTicks: number): Promise<void> {
  try {
    const resp = await fetchProgress(m.port);
    unreachable.set(m.id, 0);
    const liveState = resp.progress?.state as MongosyncState | undefined;

    // Resume: a respawned binary comes up IDLE/INITIALIZING with persisted state.
    // Re-issue /start so mongosync resumes the in-progress migration. (Verified against
    // mongosync docs — see Task 8 verification note.)
    if (m.desiredRunning && liveState && RESUME_STATES.includes(liveState)) {
      try { await sendCommand(m.port, "start", buildStartBody(m)); } catch { /* next tick retries */ }
      return;
    }

    if (liveState && liveState !== m.state) updateMigration(m.id, { state: liveState });
    insertMetric(progressToMetric(m.id, resp));
  } catch {
    if (!m.desiredRunning) return; // not supervised → nothing to rescue
    const name = sessionName(m.id);
    if (!sessionExists(name)) return; // gone entirely → reconcile() will recreate it
    const { consecutive, action } = classifyTick(unreachable.get(m.id) ?? 0, "unreachable", hungTicks);
    unreachable.set(m.id, consecutive);
    if (action === "restart") {
      // Kill the pane; reconcile() (next tick / same run) recreates the session.
      killSession(name);
      unreachable.set(m.id, 0);
      updateMigration(m.id, { supervisionStatus: "restarting", lastRestartAt: Date.now() });
    }
  }
}

export async function pollOnce(): Promise<void> {
  // Drive desired-vs-actual first so crashed/missing sessions are rebuilt before probing.
  reconcile();
  const cfg = getSupervisionConfig();
  for (const m of getAllMigrations()) {
    if (!m.desiredRunning && !ACTIVE_STATES.includes(m.state)) continue;
    await probe(m, cfg.hungTicks);
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/poller.test.ts && npx tsc --noEmit`
Expected: PASS; `tsc` clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/poller.ts src/lib/__tests__/poller.test.ts
git commit -m "feat(poller): reconcile, hung-detection restart, and resume re-drive"
```

---

### Task 9: Reroute process-manager through the supervisor (with tmux fallback)

**Files:**
- Modify: `src/lib/process-manager.ts`
- Test: `src/lib/__tests__/process-manager.test.ts` (extend)

**Interfaces:**
- Consumes: `superviseStart`, `superviseStop` from `supervisor.ts`; `hasTmux` from `tmux.ts`; `getSupervisionConfig`.
- Produces: `spawnMongosync(migration)` now starts a supervised session when tmux is available and mode is `supervised`; otherwise falls back to the legacy detached spawn and marks `supervisionStatus="unsupervised"`. `killMongosync(migration)` routes through `superviseStop` (intentional) in supervised mode, else legacy SIGTERM.

> To avoid a circular import (`supervisor.ts` imports `resolveMongosyncBin` from `process-manager.ts`), import supervisor lazily inside the functions with `await import(...)`, OR move `resolveMongosyncBin` into a tiny `src/lib/resolve-bin.ts` and have both import from there. **Choose the latter** — there is already a `resolve-bin.test.ts` in the repo, indicating this seam is expected.

- [ ] **Step 1: Extract `resolveMongosyncBin` to break the cycle**

Create `src/lib/resolve-bin.ts` and move the existing `resolveMongosyncBin` (and its `getMongosyncPath` helper) there verbatim:

```typescript
import fs from "fs";
import path from "path";
import { getSetting } from "./db";

export function resolveMongosyncBin(): string {
  const configured = getSetting("mongosyncPath")?.trim();
  if (!configured) return "mongosync";
  try {
    if (configured.endsWith("/") || (fs.existsSync(configured) && fs.statSync(configured).isDirectory())) {
      return path.join(configured, "mongosync");
    }
  } catch {
    // stat failed — fall through and use the configured value as-is
  }
  return configured;
}

export function getMongosyncPath(): string {
  return resolveMongosyncBin();
}
```

In `process-manager.ts`, delete the old `resolveMongosyncBin`/`getMongosyncPath` definitions and instead:

```typescript
import { resolveMongosyncBin, getMongosyncPath } from "./resolve-bin";
export { resolveMongosyncBin } from "./resolve-bin";
```

Update `supervisor.ts` import to `import { resolveMongosyncBin } from "./resolve-bin";`.

- [ ] **Step 2: Write the failing test**

Append to `src/lib/__tests__/process-manager.test.ts`:

```typescript
import { describe as describe2, it as it2, expect as expect2, vi, beforeEach } from "vitest";

const sup = { superviseStart: vi.fn(), superviseStop: vi.fn() };
const tmuxMod = { hasTmux: vi.fn(() => true) };
vi.mock("@/lib/supervisor", () => sup);
vi.mock("@/lib/tmux", () => ({ ...tmuxMod, sessionName: (id: string) => `msync-${id}` }));

describe2("process-manager supervised routing", () => {
  beforeEach(() => { vi.resetModules(); sup.superviseStart.mockReset(); tmuxMod.hasTmux.mockReturnValue(true); });

  it2("spawnMongosync delegates to superviseStart when tmux is available", async () => {
    const { spawnMongosync } = await import("@/lib/process-manager");
    const migration = { id: "x", port: 27182 } as never;
    spawnMongosync(migration);
    expect2(sup.superviseStart).toHaveBeenCalledWith(migration);
  });
});
```

> The existing liveness tests in this file stay as-is.

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/process-manager.test.ts`
Expected: FAIL — `spawnMongosync` still does a raw detached spawn, never calls `superviseStart`.

- [ ] **Step 4: Implement the routing**

In `process-manager.ts`, rename the existing detached-spawn body to `legacySpawn` and add supervised routing:

```typescript
import { hasTmux } from "./tmux";
import { getSupervisionConfig } from "./supervision-config";
import { superviseStart, superviseStop } from "./supervisor";
import { updateMigration } from "./db";

function legacySpawn(migration: Migration): number {
  const configPath = generateConfig(migration);
  const logDir = getLogDir(migration.id);
  const outFd = fs.openSync(path.join(logDir, "stdout.log"), "a");
  const errFd = fs.openSync(path.join(logDir, "stderr.log"), "a");
  const child = spawn(getMongosyncPath(), ["--config", configPath], {
    detached: true,
    stdio: ["ignore", outFd, errFd],
  });
  fs.closeSync(outFd);
  fs.closeSync(errFd);
  if (!child.pid) throw new Error("Failed to spawn mongosync (binary not found or not executable?)");
  child.unref();
  updateMigration(migration.id, { pid: child.pid, supervisionStatus: "unsupervised" });
  return child.pid;
}

export function spawnMongosync(migration: Migration): number {
  const supervised = getSupervisionConfig().mode === "supervised" && hasTmux();
  if (supervised) {
    superviseStart(migration);
    return 0; // pid is informational only under supervision; identity is the session name
  }
  return legacySpawn(migration);
}

export function killMongosync(migration: Migration): void {
  const supervised = getSupervisionConfig().mode === "supervised" && hasTmux();
  if (supervised) {
    superviseStop(migration.id, { intentional: true });
    return;
  }
  if (migration.pid && isProcessAlive(migration.pid)) {
    try { process.kill(migration.pid, "SIGTERM"); } catch { /* already gone */ }
  }
  updateMigration(migration.id, { pid: null });
}
```

Keep `isProcessAlive`, `sendCommand`, `fetchProgress`, and the `ProgressResponse`/`VerificationSide` interfaces unchanged.

> Circular-import note: `process-manager.ts` now imports `supervisor.ts`, which imports `resolve-bin.ts` (not `process-manager.ts`) — no cycle.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/process-manager.test.ts src/lib/__tests__/resolve-bin.test.ts && npx tsc --noEmit`
Expected: PASS; `tsc` clean. (If `resolve-bin.test.ts` imported from `process-manager`, it still resolves via the re-export.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/process-manager.ts src/lib/resolve-bin.ts src/lib/supervisor.ts src/lib/__tests__/process-manager.test.ts
git commit -m "feat(process-manager): route through supervisor with tmux fallback"
```

---

### Task 10: Startup reconciliation

**Files:**
- Modify: `src/lib/init.ts`
- Test: `src/lib/__tests__/init.test.ts` (create)

**Interfaces:**
- Consumes: `reconcile` from `supervisor.ts`; `getSupervisionConfig`; existing `detectBinary`, `startPoller`.
- Produces: `initApp()` calls `reconcile()` (supervised mode) on startup so sessions for `desiredRunning` migrations are rebuilt after a server restart or reboot.

- [ ] **Step 1: Write the failing test**

`src/lib/__tests__/init.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "path";
import fs from "fs";
import os from "os";

const supervisor = { reconcile: vi.fn() };
const poller = { startPoller: vi.fn() };
vi.mock("@/lib/supervisor", () => supervisor);
vi.mock("@/lib/poller", () => poller);
vi.mock("node:child_process", () => ({ execFileSync: () => { throw new Error("no binary"); } }));

let dir: string, prev: string | undefined;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mongosync-ui-test-"));
  prev = process.env.MONGOSYNC_UI_DIR; process.env.MONGOSYNC_UI_DIR = dir;
  vi.resetModules(); supervisor.reconcile.mockReset(); poller.startPoller.mockReset();
});
afterEach(() => { process.env.MONGOSYNC_UI_DIR = prev; fs.rmSync(dir, { recursive: true, force: true }); });

describe("initApp", () => {
  it("reconciles supervised sessions and starts the poller", async () => {
    const { initApp } = await import("@/lib/init");
    initApp();
    expect(supervisor.reconcile).toHaveBeenCalled();
    expect(poller.startPoller).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/init.test.ts`
Expected: FAIL — `initApp` does not call `reconcile`.

- [ ] **Step 3: Update `init.ts`**

Replace the reconciliation loop in `initApp()` with a call to the supervisor, keeping legacy dead-PID cleanup as a fallback:

```typescript
import { getAllMigrations, updateMigration, getSetting, setSetting } from "./db";
import { isProcessAlive } from "./process-manager";
import { reconcile } from "./supervisor";
import { getSupervisionConfig } from "./supervision-config";
import { hasTmux } from "./tmux";
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

  detectBinary();

  if (getSupervisionConfig().mode === "supervised" && hasTmux()) {
    // Rebuild sessions for migrations that should be running (server restart / reboot).
    reconcile();
  } else {
    // Legacy: reconcile dead PIDs that died while the server was down.
    for (const m of getAllMigrations()) {
      if (m.pid && !isProcessAlive(m.pid)) updateMigration(m.id, { pid: null });
    }
  }

  startPoller(Number(getSetting("pollInterval") || "5000"));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/init.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/init.ts src/lib/__tests__/init.test.ts
git commit -m "feat(init): rebuild supervised sessions on startup via reconcile"
```

---

### Task 11: API routes — intentional-stop semantics

**Files:**
- Modify: `src/app/api/migrations/[id]/start/route.ts`, `.../pause/route.ts`, `.../resume/route.ts`, `.../commit/route.ts`, `.../route.ts` (DELETE), `src/app/api/migrations/route.ts`
- Test: none new (these are thin glue routes; behavior is covered by supervisor/process-manager unit tests). Manual verification step included.

**Interfaces:**
- Consumes: `superviseStart`/`superviseStop` (indirectly via `spawnMongosync`/`killMongosync`), `updateMigration`.
- Produces: lifecycle routes set `desiredRunning` consistent with intent so the monitor never fights the user.

- [ ] **Step 1: `start` route — mark desired-running**

In `start/route.ts`, after a successful `sendCommand(..., "start", ...)`:

```typescript
    await sendCommand(migration.port, "start", buildStartBody(migration));
    updateMigration(id, { state: "RUNNING", desiredRunning: 1, supervisionStatus: "running" });
    return NextResponse.json({ ok: true });
```

- [ ] **Step 2: `pause` route — keep the process, stop desiring auto-restart of the *sync*, but keep the session**

Pause is a mongosync API state, not a process stop. The process must stay up. Leave `desiredRunning=1` (the session should keep running so resume works) and only update state:

```typescript
    await sendCommand(migration.port, "pause");
    updateMigration(id, { state: "PAUSED" });
    return NextResponse.json({ ok: true });
```

> Rationale: pausing the *sync* is different from stopping the *process*. The tmux session stays; the binary stays `PAUSED`. No supervision change needed.

- [ ] **Step 3: `resume` and `commit` routes — no supervision change**

Confirm `resume/route.ts` and `commit/route.ts` only call `sendCommand` + `updateMigration({ state })`. No `desiredRunning` change. (Commit transitions to COMMITTED automatically; the process should keep running until the user deletes it.)

- [ ] **Step 4: DELETE route — intentional stop + delete**

`[id]/route.ts` DELETE already calls `killMongosync` (now routes to `superviseStop` intentional) then `deleteMigration`. Verify the order is `killMongosync(migration)` → `deleteMigration(id)` so the stop sentinel + session kill happen before the row is removed (otherwise the orphan sweep handles it anyway). No code change if already in that order.

- [ ] **Step 5: Create route — unchanged**

`migrations/route.ts` calls `spawnMongosync` (now supervised) at create time; the new migration starts a session but `desiredRunning` stays 0 until `/start`. Confirm no change needed: the session runs the wrapper, mongosync sits `IDLE`, the poller's resume branch only fires when `desiredRunning=1`, so an unstarted migration won't be auto-started. ✔️

- [ ] **Step 6: Type-check and manual smoke (documented, not automated here)**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

Manual smoke (record results in the PR description): with tmux installed and a fake/real mongosync, create → start → confirm `tmux ls` shows `msync-<id>`; pause/resume/commit transitions reflect in the UI; delete removes the session.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/migrations
git commit -m "feat(api): set desiredRunning intent across lifecycle routes"
```

---

### Task 12: OS unit generation

**Files:**
- Create: `src/lib/os-unit.ts`
- Test: `src/lib/__tests__/os-unit.test.ts`

**Interfaces:**
- Produces:
  - `systemdUnit(opts: { execStart: string; workingDir: string }): string`
  - `launchdPlist(opts: { execArgs: string[]; workingDir: string; label: string }): string`
  - `unitTargetPath(platform: NodeJS.Platform): string`
  - `LAUNCHD_LABEL = "com.mongosyncui.app"`

- [ ] **Step 1: Write the failing test**

`src/lib/__tests__/os-unit.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { systemdUnit, launchdPlist, unitTargetPath, LAUNCHD_LABEL } from "@/lib/os-unit";

describe("os-unit generation", () => {
  it("systemd unit restarts on failure and starts at boot", () => {
    const u = systemdUnit({ execStart: "/usr/bin/npm run start", workingDir: "/srv/app" });
    expect(u).toContain("ExecStart=/usr/bin/npm run start");
    expect(u).toContain("WorkingDirectory=/srv/app");
    expect(u).toContain("Restart=on-failure");
    expect(u).toContain("WantedBy=default.target");
  });

  it("launchd plist runs at load and keeps alive", () => {
    const p = launchdPlist({ execArgs: ["/usr/bin/npm", "run", "start"], workingDir: "/srv/app", label: LAUNCHD_LABEL });
    expect(p).toContain("<key>RunAtLoad</key>");
    expect(p).toContain("<true/>");
    expect(p).toContain("<key>KeepAlive</key>");
    expect(p).toContain(LAUNCHD_LABEL);
    expect(p).toContain("<string>/usr/bin/npm</string>");
  });

  it("targets the right install path per platform", () => {
    expect(unitTargetPath("linux")).toContain(".config/systemd/user/mongosync-ui.service");
    expect(unitTargetPath("darwin")).toContain("Library/LaunchAgents/com.mongosyncui.app.plist");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/os-unit.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`src/lib/os-unit.ts`:

```typescript
import path from "path";
import os from "os";

export const LAUNCHD_LABEL = "com.mongosyncui.app";

export function systemdUnit(opts: { execStart: string; workingDir: string }): string {
  return `[Unit]
Description=MongosyncUI
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${opts.workingDir}
ExecStart=${opts.execStart}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`;
}

export function launchdPlist(opts: { execArgs: string[]; workingDir: string; label: string }): string {
  const args = opts.execArgs.map((a) => `    <string>${a}</string>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${opts.label}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>WorkingDirectory</key>
  <string>${opts.workingDir}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
</dict>
</plist>
`;
}

export function unitTargetPath(platform: NodeJS.Platform): string {
  if (platform === "darwin") {
    return path.join(os.homedir(), "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);
  }
  return path.join(os.homedir(), ".config", "systemd", "user", "mongosync-ui.service");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/os-unit.test.ts`
Expected: PASS (all three cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/os-unit.ts src/lib/__tests__/os-unit.test.ts
git commit -m "feat(os-unit): generate systemd unit and launchd plist"
```

---

### Task 13: OS unit install/uninstall + CLI

**Files:**
- Modify: `src/lib/os-unit.ts` (add install/uninstall/status)
- Create: `scripts/supervisor-cli.mjs`
- Modify: `package.json` (scripts)
- Test: `src/lib/__tests__/os-unit.test.ts` (add install-status case writing to a temp HOME)

**Interfaces:**
- Produces:
  - `installBootService(): { path: string; followUp: string }` — writes the unit/plist, returns the path + a one-line follow-up command the user must run (enable+linger on Linux, `launchctl load` on macOS).
  - `uninstallBootService(): { path: string; followUp: string }`
  - `bootServiceStatus(): { installed: boolean; path: string }`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/__tests__/os-unit.test.ts`:

```typescript
import { beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path2 from "path";
import os2 from "os";

describe("boot service install", () => {
  let home: string, prevHome: string | undefined;
  beforeEach(() => {
    home = fs.mkdtempSync(path2.join(os2.tmpdir(), "home-"));
    prevHome = process.env.HOME; process.env.HOME = home;
    vi.resetModules();
  });
  afterEach(() => { process.env.HOME = prevHome; fs.rmSync(home, { recursive: true, force: true }); });

  it("install writes a unit file and status reports installed", async () => {
    const { installBootService, bootServiceStatus, uninstallBootService } = await import("@/lib/os-unit");
    expect(bootServiceStatus().installed).toBe(false);
    const { path: p } = installBootService();
    expect(fs.existsSync(p)).toBe(true);
    expect(bootServiceStatus().installed).toBe(true);
    uninstallBootService();
    expect(bootServiceStatus().installed).toBe(false);
  });
});
```

> `os.homedir()` reads `$HOME` on POSIX, so overriding `process.env.HOME` redirects the target path in the test.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/os-unit.test.ts`
Expected: FAIL — `installBootService` is not exported.

- [ ] **Step 3: Add install/uninstall/status to `os-unit.ts`**

```typescript
import fs from "fs";

function execStartParts(): { npm: string; cwd: string } {
  // Prefer an absolute npm if available; fall back to bare "npm" (PATH at boot may be slim,
  // so document that users can edit the unit to an absolute node path if needed).
  return { npm: process.execPath ? `${process.execPath}` : "npm", cwd: process.cwd() };
}

export function installBootService(): { path: string; followUp: string } {
  const target = unitTargetPath(process.platform);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const cwd = process.cwd();
  if (process.platform === "darwin") {
    const node = process.execPath; // absolute node path; runs the Next start script
    fs.writeFileSync(
      target,
      launchdPlist({ execArgs: [node, path.join(cwd, "node_modules/.bin/next"), "start"], workingDir: cwd, label: LAUNCHD_LABEL })
    );
    return { path: target, followUp: `launchctl load ${target}` };
  }
  const next = path.join(cwd, "node_modules/.bin/next");
  fs.writeFileSync(target, systemdUnit({ execStart: `${next} start`, workingDir: cwd }));
  return {
    path: target,
    followUp: "systemctl --user daemon-reload && systemctl --user enable --now mongosync-ui && loginctl enable-linger \"$USER\"",
  };
}

export function uninstallBootService(): { path: string; followUp: string } {
  const target = unitTargetPath(process.platform);
  fs.rmSync(target, { force: true });
  if (process.platform === "darwin") {
    return { path: target, followUp: `launchctl unload ${target} 2>/dev/null || true` };
  }
  return { path: target, followUp: "systemctl --user disable --now mongosync-ui 2>/dev/null || true" };
}

export function bootServiceStatus(): { installed: boolean; path: string } {
  const target = unitTargetPath(process.platform);
  return { installed: fs.existsSync(target), path: target };
}
```

> `execStartParts` is unused scaffolding — delete it; the inline logic above is what ships. (Removed to satisfy the no-dead-code lint.)

Remove the `execStartParts` helper before committing.

- [ ] **Step 4: Add the CLI**

`scripts/supervisor-cli.mjs`:

```javascript
#!/usr/bin/env node
// Usage: node scripts/supervisor-cli.mjs <install|uninstall|status>
import { installBootService, uninstallBootService, bootServiceStatus } from "../src/lib/os-unit.ts";

const cmd = process.argv[2];
if (cmd === "install") {
  const { path, followUp } = installBootService();
  console.log(`Wrote boot service: ${path}\nNow run:\n  ${followUp}`);
} else if (cmd === "uninstall") {
  const { path, followUp } = uninstallBootService();
  console.log(`Removed boot service: ${path}\nCleanup:\n  ${followUp}`);
} else if (cmd === "status") {
  console.log(JSON.stringify(bootServiceStatus(), null, 2));
} else {
  console.error("Usage: supervisor-cli <install|uninstall|status>");
  process.exit(1);
}
```

> Importing a `.ts` file from `.mjs` requires a TS-aware loader. Add the scripts to use `tsx`:

In `package.json` `"scripts"`:

```json
    "supervisor:install": "tsx scripts/supervisor-cli.mjs install",
    "supervisor:uninstall": "tsx scripts/supervisor-cli.mjs uninstall",
    "supervisor:status": "tsx scripts/supervisor-cli.mjs status"
```

And add `tsx` to devDependencies:

```bash
npm install -D tsx
```

- [ ] **Step 5: Run tests + verify CLI status**

```bash
npx vitest run src/lib/__tests__/os-unit.test.ts
npm run supervisor:status
```
Expected: tests PASS; `supervisor:status` prints `{ "installed": false, "path": "..." }` (or true if you ran install).

- [ ] **Step 6: Commit**

```bash
git add src/lib/os-unit.ts scripts/supervisor-cli.mjs package.json package-lock.json src/lib/__tests__/os-unit.test.ts
git commit -m "feat(os-unit): install/uninstall/status + supervisor CLI"
```

---

### Task 14: Supervision settings API + Settings panel

**Files:**
- Modify: `src/app/api/settings/route.ts`
- Create: `src/app/api/supervision/route.ts`
- Modify: `src/app/settings/page.tsx`
- Test: none new (UI). Manual verification step included.

**Interfaces:**
- Consumes: settings keys `supervisionMode`, `backoffCapSec`, `crashLoopMax`, `crashLoopWindowSec`, `hungTicks`; `bootServiceStatus`/`installBootService`/`uninstallBootService` from `os-unit.ts`.
- Produces: settings persist the new keys; `/api/supervision` GET returns boot-service status, POST `{action:"install"|"uninstall"}` performs it.

- [ ] **Step 1: Extend the settings allow-list**

In `src/app/api/settings/route.ts`, add the new keys to `KEYS`:

```typescript
const KEYS = [
  "mongosyncPath",
  "pollInterval",
  "basePort",
  "defaultLoadLevel",
  "defaultVerbosity",
  "defaultVerification",
  "defaultDisableTelemetry",
  "supervisionMode",
  "backoffCapSec",
  "crashLoopMax",
  "crashLoopWindowSec",
  "hungTicks",
];
```

- [ ] **Step 2: Create the supervision boot-service route**

`src/app/api/supervision/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { bootServiceStatus, installBootService, uninstallBootService } from "@/lib/os-unit";
import { hasTmux } from "@/lib/tmux";

export async function GET() {
  return NextResponse.json({ ...bootServiceStatus(), tmux: hasTmux(), platform: process.platform });
}

export async function POST(req: NextRequest) {
  const { action } = (await req.json()) as { action?: string };
  try {
    if (action === "install") return NextResponse.json(installBootService());
    if (action === "uninstall") return NextResponse.json(uninstallBootService());
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
```

- [ ] **Step 3: Add the Supervision card to the Settings page**

In `src/app/settings/page.tsx`, extend the `Settings` interface + `DEFAULTS`:

```typescript
interface Settings {
  mongosyncPath: string;
  pollInterval: string;
  basePort: string;
  defaultLoadLevel: string;
  defaultVerbosity: string;
  defaultVerification: string;
  defaultDisableTelemetry: string;
  supervisionMode: string;
  backoffCapSec: string;
  crashLoopMax: string;
  crashLoopWindowSec: string;
  hungTicks: string;
}

const DEFAULTS: Settings = {
  mongosyncPath: "", pollInterval: "5000", basePort: "27182",
  defaultLoadLevel: "3", defaultVerbosity: "INFO",
  defaultVerification: "true", defaultDisableTelemetry: "false",
  supervisionMode: "supervised", backoffCapSec: "60", crashLoopMax: "5",
  crashLoopWindowSec: "300", hungTicks: "6",
};
```

Add boot-service state + handlers near the other `useState` hooks:

```typescript
  const [boot, setBoot] = useState<{ installed: boolean; path: string; tmux: boolean; platform: string } | null>(null);
  useEffect(() => { fetch("/api/supervision").then((r) => r.json()).then(setBoot).catch(() => {}); }, []);

  const toggleBoot = async (action: "install" | "uninstall") => {
    try {
      const res = await fetch("/api/supervision", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      toast.success(action === "install" ? "Boot service installed" : "Boot service removed", {
        description: data.followUp ? `Run: ${data.followUp}` : undefined, duration: 12000,
      });
      const r = await fetch("/api/supervision"); setBoot(await r.json());
    } catch (e) { toast.error("Failed", { description: (e as Error).message }); }
  };
```

Insert this `Card` before the final Save button:

```tsx
        <Card>
          <CardHeader>
            <CardTitle>Supervision &amp; Fault Tolerance</CardTitle>
            <CardDescription>
              How mongosync instances are kept alive. Supervised mode runs each in a tmux session
              with automatic restart on crash or hang.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="supervisionMode">Mode</Label>
              <select id="supervisionMode" className={selectClass}
                value={s.supervisionMode} onChange={(e) => set("supervisionMode")(e.target.value)}>
                <option value="supervised">Supervised (tmux + auto-restart)</option>
                <option value="legacy">Legacy (detached, no auto-restart)</option>
              </select>
              {boot && !boot.tmux && (
                <p className="text-sm text-destructive">
                  tmux not found — supervised mode falls back to legacy. Install tmux to enable fault tolerance.
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="hungTicks">Hung threshold (poll ticks)</Label>
                <Input id="hungTicks" type="number" min={2} value={s.hungTicks}
                  onChange={(e) => set("hungTicks")(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="backoffCapSec">Restart backoff cap (s)</Label>
                <Input id="backoffCapSec" type="number" min={1} value={s.backoffCapSec}
                  onChange={(e) => set("backoffCapSec")(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="crashLoopMax">Crash-loop cap (restarts)</Label>
                <Input id="crashLoopMax" type="number" min={1} value={s.crashLoopMax}
                  onChange={(e) => set("crashLoopMax")(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="crashLoopWindowSec">Crash-loop window (s)</Label>
                <Input id="crashLoopWindowSec" type="number" min={10} value={s.crashLoopWindowSec}
                  onChange={(e) => set("crashLoopWindowSec")(e.target.value)} />
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-border pt-4">
              <div>
                <p className="text-sm font-medium">Start at boot</p>
                <p className="text-xs text-muted-foreground">
                  {boot?.installed ? "Installed" : "Not installed"}
                  {boot ? ` · ${boot.platform === "darwin" ? "launchd" : "systemd --user"}` : ""}
                </p>
              </div>
              {boot?.installed
                ? <Button variant="outline" onClick={() => toggleBoot("uninstall")}>Remove boot service</Button>
                : <Button variant="outline" onClick={() => toggleBoot("install")}>Install boot service</Button>}
            </div>
          </CardContent>
        </Card>
```

- [ ] **Step 4: Type-check, lint, manual check**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

Manual: `npm run dev`, open `/settings`, confirm the Supervision card renders, mode persists across save/reload, and the boot-service install/remove button reflects status.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/settings/route.ts src/app/api/supervision/route.ts src/app/settings/page.tsx
git commit -m "feat(settings): supervision config + boot-service panel"
```

---

### Task 15: Supervision status badge + crash-loop alert + retry

**Files:**
- Create: `src/components/supervision-badge.tsx`
- Create: `src/app/api/migrations/[id]/retry/route.ts`
- Modify: `src/components/migration-card.tsx` (render the badge) and the detail page `src/app/migrations/[id]/page.tsx` (crash-loop alert + Retry)
- Test: `src/lib/__tests__/supervisor.test.ts` (add a `retrySupervision` case)

**Interfaces:**
- Consumes: `Migration.supervisionStatus`, `lastExitCode`, `restartCount`.
- Produces:
  - `retrySupervision(id)` in `supervisor.ts` — resets `restartCount`, clears the status file, calls `superviseStart` with a fresh migration row.
  - `<SupervisionBadge status={...} />` component.
  - POST `/api/migrations/[id]/retry` route.

- [ ] **Step 1: Write the failing test for `retrySupervision`**

Append to `src/lib/__tests__/supervisor.test.ts`:

```typescript
  it("retrySupervision resets crash-loop state and restarts", async () => {
    const { db, sup } = await setup();
    const m = db.createMigration({ name: "m", sourceUri: "mongodb://a", destUri: "mongodb://b", config: {}, port: 27182 });
    db.updateMigration(m.id, { desiredRunning: 1, supervisionStatus: "crash_looping", restartCount: 5 });
    fs.writeFileSync(sup.statusPath(m.id), JSON.stringify({ attempt: 5, lastExitCode: 7, lastStartAt: 1, state: "crash_looping" }));
    tmux.sessionExists.mockReturnValue(false);
    sup.retrySupervision(m.id);
    expect(db.getMigration(m.id)!.restartCount).toBe(0);
    expect(db.getMigration(m.id)!.supervisionStatus).toBe("running");
    expect(fs.existsSync(sup.statusPath(m.id))).toBe(false);
    expect(tmux.startSession).toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/supervisor.test.ts`
Expected: FAIL — `retrySupervision` is not exported.

- [ ] **Step 3: Implement `retrySupervision`**

Add to `src/lib/supervisor.ts`:

```typescript
export function retrySupervision(id: string): void {
  fs.rmSync(statusPath(id), { force: true });
  updateMigration(id, { restartCount: 0, lastExitCode: null, supervisionStatus: "running", desiredRunning: 1 });
  const fresh = getMigration(id);
  if (fresh) superviseStart(fresh);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/supervisor.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the retry API route**

`src/app/api/migrations/[id]/retry/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getMigration } from "@/lib/db";
import { retrySupervision } from "@/lib/supervisor";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getMigration(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    retrySupervision(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
```

- [ ] **Step 6: Add the badge component**

`src/components/supervision-badge.tsx`:

```tsx
import { cn } from "@/lib/utils";
import type { SupervisionStatus } from "@/lib/types";

const STYLE: Record<SupervisionStatus, { label: string; cls: string }> = {
  running: { label: "supervised", cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
  restarting: { label: "restarting", cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  crash_looping: { label: "crash-looping", cls: "bg-red-500/15 text-red-600 dark:text-red-400" },
  stopped: { label: "stopped", cls: "bg-muted text-muted-foreground" },
  unsupervised: { label: "unsupervised", cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
};

export function SupervisionBadge({ status }: { status: SupervisionStatus }) {
  const s = STYLE[status] ?? STYLE.stopped;
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide", s.cls)}>
      {s.label}
    </span>
  );
}
```

- [ ] **Step 7: Render the badge + crash-loop alert**

In `src/components/migration-card.tsx`, import and render `<SupervisionBadge status={migration.supervisionStatus} />` next to the existing `<StateBadge />` (match the existing badge placement/markup).

In `src/app/migrations/[id]/page.tsx`, when `migration.supervisionStatus === "crash_looping"`, render a prominent alert with `lastExitCode` and a Retry button:

```tsx
{migration.supervisionStatus === "crash_looping" && (
  <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 space-y-2">
    <p className="text-sm font-medium text-destructive">
      mongosync is crash-looping (last exit code {migration.lastExitCode ?? "?"}, {migration.restartCount} restarts).
    </p>
    <p className="text-xs text-muted-foreground">
      Check the logs below for the cause. Once resolved, retry supervision.
    </p>
    <Button variant="outline" size="sm" onClick={async () => {
      await fetch(`/api/migrations/${migration.id}/retry`, { method: "POST" });
      location.reload();
    }}>Retry</Button>
  </div>
)}
```

> Match the import style and `Button` usage already present in the detail page.

- [ ] **Step 8: Type-check, lint, manual check**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean. Manual: with the fake binary set to crash, confirm the card badge flips to `crash-looping` and the detail-page alert + Retry appears and works.

- [ ] **Step 9: Commit**

```bash
git add src/lib/supervisor.ts src/lib/__tests__/supervisor.test.ts src/components/supervision-badge.tsx src/components/migration-card.tsx "src/app/migrations/[id]/page.tsx" "src/app/api/migrations/[id]/retry/route.ts"
git commit -m "feat(ui): supervision badge, crash-loop alert, and retry"
```

---

### Task 16: End-to-end integration tests (real tmux + fake binary)

**Files:**
- Create: `src/lib/__tests__/fixtures/fake-mongosync.sh`
- Modify: `src/lib/__tests__/supervision.integration.test.ts` (add E2E cases)

**Interfaces:**
- Consumes: real `tmux`, real wrapper script, `supervisor.ts`.
- Produces: a fake binary controllable via env: `FAKE_MODE=normal|crash|hang`, `FAKE_PORT`, `FAKE_STATE_FILE`.

> All E2E cases auto-skip when tmux is unavailable so tmux-less CI still passes.

- [ ] **Step 1: Write the fake binary**

`src/lib/__tests__/fixtures/fake-mongosync.sh`:

```bash
#!/usr/bin/env bash
# Fake mongosync for fault injection. Ignores --config. Behavior via env:
#   FAKE_MODE=normal|crash|hang   FAKE_PORT=<port>   FAKE_STATE=<IDLE|RUNNING>
set -u
MODE="${FAKE_MODE:-normal}"
PORT="${FAKE_PORT:-27199}"
STATE="${FAKE_STATE:-RUNNING}"

if [ "$MODE" = "crash" ]; then
  exit 7
fi

# Serve a minimal /api/v1/progress using nc, looping. "hang" mode sleeps without serving.
if [ "$MODE" = "hang" ]; then
  sleep 3600
  exit 0
fi

BODY='{"success":true,"progress":{"state":"'"$STATE"'","canCommit":false,"canWrite":false}}'
while true; do
  printf 'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: %d\r\n\r\n%s' \
    "${#BODY}" "$BODY" | nc -l "$PORT" >/dev/null 2>&1 || sleep 1
done
```

> If `nc` semantics differ across platforms, the test gates on `command -v nc`; otherwise the case is skipped. The crash/hang cases (which don't need `nc`) always run when tmux is present.

- [ ] **Step 2: Write the E2E cases**

Append to `src/lib/__tests__/supervision.integration.test.ts`:

```typescript
import { spawnSync as sp } from "node:child_process";

const TMUX = sp("tmux", ["-V"]).status === 0;
const d = TMUX ? describe : describe.skip;

d("supervision E2E (real tmux)", () => {
  // Helper: point the app at a temp data dir + fake binary, run supervisor, assert via tmux.
  it("respawns after a crash and records attempts", async () => {
    // Arrange a migration whose wrapper runs the crashing fake binary with a small cap,
    // start it via supervisor.superviseStart, wait, then assert the status file shows
    // multiple attempts and the session was created.
    // (Full body mirrors Task 5's harness: write fake bin, create migration, set
    //  mongosyncPath, superviseStart, poll the status file until attempt >= 2.)
    expect(TMUX).toBe(true);
  });
});
```

> The crash/hang/server-restart bodies follow the same arrange pattern as Task 5 (temp dir, fake binary via `setSetting("mongosyncPath", …)`, `superviseStart`, then assert on `readWrapperStatus` / `tmux has-session`). Fill each with the concrete assertions: crash → `readWrapperStatus(id).attempt >= 2`; hang → after `hungTicks` `pollOnce()` calls `tmux has-session` was recreated; server-restart → drop in-memory state (`vi.resetModules()`), call `reconcile()`, assert `sessionExists` true without any stored PID.

- [ ] **Step 3: Make fixtures executable, run**

```bash
chmod +x src/lib/__tests__/fixtures/fake-mongosync.sh
npx vitest run src/lib/__tests__/supervision.integration.test.ts
```
Expected: PASS where tmux is present; SKIP cleanly where it is not.

- [ ] **Step 4: Commit**

```bash
git add src/lib/__tests__/fixtures/fake-mongosync.sh src/lib/__tests__/supervision.integration.test.ts
git commit -m "test(supervision): E2E crash/hang/restart with real tmux + fake binary"
```

---

### Task 17: Documentation

**Files:**
- Modify: `CLAUDE.md`, `README.md`

**Interfaces:** none (docs).

- [ ] **Step 1: Update CLAUDE.md design decisions**

In `CLAUDE.md` under "Key Design Decisions", replace the "No daemon" bullet and adjust "No WebSockets"/"One mongosync process" context:

```markdown
- **Supervised processes** — each mongosync runs in a tmux session (`msync-<id>`) under a
  respawn wrapper (crash → relaunch with backoff + crash-loop cap). The app's poller is a
  health monitor that reconciles desired-vs-actual state, restarts hung instances, and
  re-drives `/start` so respawned binaries resume. Identity is the session name + a
  `/progress` handshake, never a raw PID. `supervisionMode=legacy` restores the old
  detached-spawn behavior; tmux-absent falls back to legacy automatically.
- **Optional boot service** — a systemd user unit (Linux) / launchd agent (macOS),
  installed from Settings, starts the app at boot so reconciliation rebuilds sessions
  after a reboot. This is the only OS-specific, optional piece.
- **No WebSockets** — client polls API every 5s for live updates.
```

Add a short "Supervision" subsection documenting the data layout (`~/.mongosync-ui/supervision/<id>/{status.json,stop}`) and the settings keys.

- [ ] **Step 2: Update README.md**

Add a "Reliable / always-on operation" section after "How it works":

```markdown
## Reliable / always-on operation

By default MongosyncUI runs each migration's `mongosync` in its own **tmux session** with
an auto-restart wrapper, so a crashed or hung instance is relaunched automatically and
sessions survive an app restart. This requires **tmux** on your `PATH`; without it the app
falls back to unsupervised processes (a banner warns you).

- Watch a live instance: `tmux attach -t msync-<migration-id>`
- Survive machine reboots: install the boot service from **Settings → Supervision**, or run
  `npm run supervisor:install` and follow the printed command. Remove it with
  `npm run supervisor:uninstall`.

Tune restart backoff, the hung-detection threshold, and the crash-loop cap under
**Settings → Supervision & Fault Tolerance**.
```

Add `tmux` to the Prerequisites list as "recommended (enables fault tolerance)".

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: document mongosync supervision model and boot service"
```

---

## Self-Review

**Spec coverage:**
- tmux session per migration + respawn wrapper → Tasks 4, 5, 6. ✔
- Wrapper-vs-monitor split → Tasks 5 (wrapper) + 8 (monitor). ✔
- Health monitor: crash/hung/stalled/missing/needs-resume/stopped → Tasks 6 (reconcile: crash/missing/stopped/crash-loop) + 7/8 (hung + resume). Note: "stalled = warning only" is realized by *omission* — the classifier only acts on unreachable, never on slow progress; documented in Global Constraints and the `classifyTick` comment. ✔
- Identity = session name + handshake, no PID → Tasks 4, 6, 9 (pid set to informational/0). ✔
- Intentional-stop ordering → Task 6 (`superviseStop`) + Task 11 (routes). ✔
- DB schema additions → Task 3. ✔
- Reboot via OS unit + single reconcile path → Tasks 12, 13, 10. ✔
- tmux-absent graceful fallback → Task 9 + Task 14 banner. ✔
- Crash-loop terminal state + Retry → Tasks 6, 15. ✔
- Settings for thresholds + mode → Tasks 2, 14. ✔
- Fake-binary test harness + unit/integration tests → Tasks 5, 7, 16 (+ unit tests throughout). ✔
- Docs (CLAUDE.md/README) → Task 17. ✔

**Placeholder scan:** Task 16's E2E case bodies are described as "mirror Task 5's harness" with explicit per-case assertions rather than full code — this is the one spot that leans on a referenced pattern. Acceptable because the harness it mirrors is fully coded in Task 5 and the exact assertions are enumerated; the implementer fills mechanical arrange steps. All other code steps are complete.

**Type consistency:** `SupervisionStatus`, `WrapperStatus`, `SupervisionConfig` defined in Task 1 and used consistently. `reconcile`, `superviseStart`, `superviseStop(id, {intentional})`, `retrySupervision(id)`, `statusPath`, `stopSentinelPath`, `readWrapperStatus`, `buildWrapperCommand` names match across Tasks 6/8/9/10/15. `classifyTick(prev, probe, hungTicks)` signature matches between Task 7 and Task 8. `sessionName/sessionExists/startSession/killSession/listMsyncSessions` consistent across Tasks 4/6/8/9. `resolveMongosyncBin` relocation (Task 9) updates both `process-manager.ts` (re-export) and `supervisor.ts` import.

**Known verification dependency:** mongosync resume mechanic (Task 8) is flagged with an explicit pre-coding verification step; the risk is isolated to the resume branch.
