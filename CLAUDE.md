# MongosyncUI

A local web UI for managing MongoDB cluster-to-cluster migrations via mongosync.

## Tech Stack

- **Next.js 14+** (App Router) — full-stack framework
- **TypeScript** — throughout
- **Tailwind CSS + shadcn/ui** — styling and components
- **recharts** — charts
- **react-hook-form + zod** — form handling and validation
- **better-sqlite3** — local database
- **nanoid** — ID generation

## Project Structure

```
src/
  app/                    # Next.js App Router pages
    page.tsx              # Dashboard (list migrations)
    migrations/
      new/page.tsx        # New migration form
      [id]/page.tsx       # Migration detail + charts
    settings/page.tsx     # Settings page
    api/                  # API routes
      migrations/         # CRUD + actions (start, pause, resume, commit, reverse)
      metrics/            # Metric queries for charts
      settings/           # Settings CRUD
      mongosync/          # Binary detection, version check
  lib/
    db.ts                 # SQLite setup + queries
    process-manager.ts    # Spawn/kill mongosync processes
    poller.ts             # Poll /progress on active migrations
    config-generator.ts   # Generate YAML configs + /start bodies
    types.ts              # Shared TypeScript types
  components/
    ui/                   # shadcn/ui components
    migration-card.tsx    # Dashboard migration card
    migration-form.tsx    # New migration form
    metrics-charts.tsx    # recharts charts
    logs-panel.tsx        # Log viewer
    state-badge.tsx       # State badge with colors
    action-buttons.tsx    # State-aware action buttons
```

## Data Directory

All runtime data lives in `~/.mongosync-ui/`:
- `data.db` — SQLite database
- `configs/` — generated YAML config files
- `logs/` — mongosync log output directories

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Start dev server (localhost:3000)
npm run build        # Production build
npm run start        # Start production server
npm run lint         # Lint with ESLint
```

## Key Design Decisions

- **Simplicity first** — minimal config, sensible defaults, single command to run
- **Supervised processes** — each mongosync runs in a tmux session (`msync-<id>`) under a
  respawn wrapper (crash → relaunch with backoff + crash-loop cap). The app's poller is a
  health monitor that reconciles desired-vs-actual state, restarts hung instances, and
  re-drives `/start` so respawned binaries resume. Identity is the session name + a
  `/progress` handshake, never a raw PID. `supervisionMode=legacy` restores the old
  detached-spawn behavior; tmux-absent falls back to legacy automatically.
- **Optional boot service** — a systemd user unit (Linux) / launchd agent (macOS),
  installed from Settings, starts the app at boot so reconciliation rebuilds sessions
  after a reboot. This is the only OS-specific, optional piece.
- **No WebSockets** — client polls API every 5s for live updates
- **No auth** — personal tool, localhost only
- **SQLite** — zero-config persistence, no extra services
- **One mongosync process per migration** — each on its own port (auto-assigned from 27182)

## Supervision

Process state and lifecycle are stored in `~/.mongosync-ui/supervision/<id>/`:
- `status.json` — current wrapper status (PID, uptime, restarts, crash-loop state)
- `stop` — sentinel file; presence signals intentional shutdown

Supervision tuning (all in Settings):
- `supervisionMode` — `supervised` (default, requires tmux) or `legacy` (old detached behavior)
- `backoffCapSec` — max backoff between crash retries (default: 60s)
- `crashLoopMax` — max crashes before terminal `CRASH_LOOP` state (default: 5)
- `crashLoopWindowSec` — time window for crash counting (default: 300s)
- `hungTicks` — consecutive poll ticks without response before hung-instance restart (default: 6)

## Mongosync API

The UI proxies commands to each mongosync process's HTTP API at
`http://localhost:{port}/api/v1/`. Every response includes `success` (bool) and,
on failure, `error` (name) + `errorDescription` (message). POST endpoints require
a body — send `{}` when there are no options.

### `POST /start` — start a sync

Request body options:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `source` | string | **required** | Name of the source cluster (`cluster0` / `cluster1`). |
| `destination` | string | **required** | Name of the destination cluster. |
| `buildIndexes` | string | `afterDataCopy` (6.0+) | When to build indexes: `afterDataCopy` \| `beforeDataCopy` \| `excludeHashed` \| `excludeHashedAfterCopy` \| `never`. |
| `reversible` | bool | `false` | Enable reverse-sync capability (6.0+; **incompatible with namespace filtering**). |
| `detectRandomId` | bool | `true` | Auto-detect collections with random `_id` and copy them in natural order. |
| `copyInNaturalOrder` | array | — | Explicit list of `{database, collection}` to copy in natural order. |
| `preExistingDestinationData` | bool | `false` | Allow pre-existing namespaces on the destination (Public Preview). |
| `includeNamespaces` | array | — | Namespace include filters (see structure below). |
| `excludeNamespaces` | array | — | Namespace exclude filters (see structure below). |
| `sharding` | document | — | Required for replica set → sharded cluster. `{ createSupportingIndexes?: bool, shardingEntries: [{ database, collection, shardCollection: { key: [{field: 1|"hashed"}] } }] }`. |
| `verification` | document | `{enabled: true}` | Embedded verifier config: `{ enabled: bool }` (v1.9+). |

**Namespace filter entry** (each item in `includeNamespaces` / `excludeNamespaces`):

| Field | Type | Description |
|-------|------|-------------|
| `database` | string | Exact database name (**or** use `databaseRegex`). |
| `databaseRegex` | `{pattern, options}` | Regex match for database names. |
| `collections` | string[] | Specific collection names (optional). |
| `collectionsRegex` | `{pattern, options}` | Regex match for collection names (optional). |

Filter rules: only namespace-level (no document filters); cannot change after start;
incompatible with reverse; cannot filter system namespaces; `mapReduce`/`$out` must
filter the whole database. There is **no** `enableUserWriteBlocking` start field —
write blocking is applied automatically at commit.

### `POST /pause` — pause running sync

Body: `{}` (no options). Requires state `RUNNING`; transitions to `PAUSED`. For long
pauses, increase the source oplog size.

### `POST /resume` — resume paused sync

Body: `{}` (no options). Resumes from `PAUSED` using state stored on the destination.

### `POST /commit` — finalize cutover

Body: `{}` (no options). Preconditions: state `RUNNING`, `canCommit: true`,
`lagTimeSeconds` near 0, **and application writes to the source stopped** (writing
during commit risks data loss). Restores temporarily-altered collection attributes
(unique/TTL/hidden indexes, capped sizes) and enables source write-blocking by default.
Transitions `RUNNING → COMMITTING → COMMITTED` (last step auto, based on lag).

### `POST /reverse` — reverse sync direction

Body: `{}` (no options). Preconditions: started with `reversible: true`; state
`COMMITTED`; destination oplog not rolled over; unique indexes formatVersion 13/14;
source/destination same shard count and same MongoDB major version; not used with
filtered sync; not on pre-6.0 sources. Swaps source/destination and resumes
(`COMMITTED → REVERSING → RUNNING`).

### `GET /progress` — current state + metrics

Response fields (under `progress`):

| Field | Type | Description |
|-------|------|-------------|
| `state` | string | Current mongosync state. |
| `canCommit` | bool | Whether a commit will succeed now. |
| `canWrite` | bool | Whether writes are permitted on the destination. |
| `info` | string | Extra progress/substate text. |
| `lagTimeSeconds` | int | Lag between latest applied event and the source. |
| `totalEventsApplied` | int | Approx. change events applied. |
| `estimatedSecondsToCEACatchup` | int | Est. time to finish Change Event Application. |
| `estimatedOplogTimeRemaining` | string | Est. oplog window left (e.g. "12 hours"). |
| `collectionCopy.estimatedCopiedBytes` | int | Bytes copied by this instance. |
| `collectionCopy.estimatedTotalBytes` | int | Est. total bytes to copy. |
| `indexBuilding.indexesBuilt` / `.totalIndexesToBuild` | int | Index build counts. |
| `indexBuilding.collectionsFinished` / `.collectionsTotal` | int | Collections with index builds done. |
| `directionMapping.Source` / `.Destination` | string | `name: host:port` for each side (note capitalized keys; updates after reverse). |
| `source.pingLatencyMs` / `destination.pingLatencyMs` | int | Ping latency (refreshed ~30s). |
| `mongosyncID` / `coordinatorID` | string | Instance / coordinator identifiers. |
| `warnings` | string[] | Warnings detected by mongosync. |
| `verification.source` / `.destination` | document | Per-cluster verifier: `phase`, `estimatedDocumentCount`, `hashedDocumentCount`, `scannedCollectionCount`, `totalCollectionCount`, `lagTimeSeconds`. |

### mongosync process options (CLI flags → generated `--config` YAML)

The UI writes a YAML config (never CLI flags — passwords would leak to process listings)
and launches `mongosync --config <file>`.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `cluster0` / `cluster1` | string (URI) | required | Connection strings for the two clusters. |
| `port` | int | 27182 | HTTP API port (one per migration, auto-assigned). |
| `logPath` | string | — | Log output directory. |
| `metricsLoggingFilepath` | string | — | Metrics log directory (`disableMetricsLogging` to turn off). |
| `verbosity` | string | DEBUG | `TRACE`/`DEBUG`/`INFO`/`WARN`/`ERROR`/`FATAL`/`PANIC`. |
| `loadLevel` | int | 3 | Workload intensity 1 (gentlest) – 4 (fastest). |
| `createIndexesBatchSize` | int | auto | Index-build batch size (1–64). |
| `id` | string | — | Instance id = shard id, for multi-instance sharded sync. |
| `disableTelemetry` | bool | false | Disable telemetry collection. |
| `disableVerification` | bool | false | Disable the embedded verifier. |
| `acceptDisclaimer` | bool | false | Accept verifier disclaimer non-interactively. |
| `enableCappedCollectionHandling` | bool | false | Allow creating capped collections during migration. |
| `hotDocIDs` | JSON | — | Frequently-updated document IDs to copy during commit. |

## Mongosync States

`IDLE -> RUNNING -> PAUSED (optional) -> COMMITTING -> COMMITTED -> REVERSING (optional) -> RUNNING`

Full state list (from `/progress`):

| State | Meaning |
|-------|---------|
| `INITIALIZING` | Process starting up; not yet ready for `/start`. |
| `IDLE` | Ready for a sync job to begin. |
| `RUNNING` | Collection copy + change event application in progress. |
| `PAUSED` | Sync paused; resumable via `/resume`. |
| `COMMITTING` | Cutover started; time-to-`COMMITTED` depends on `lagTimeSeconds`. |
| `COMMITTED` | Cutover complete; source write-blocked, destination writable. |
| `REVERSING` | Swapping source/destination, then resuming in reverse. |

Notable auto-transitions: `COMMITTING -> COMMITTED` and `REVERSING -> RUNNING` happen automatically.

## UI Functionalities to Implement

This is the master checklist of features the UI must expose, derived from the official
mongosync docs (https://www.mongodb.com/docs/mongosync/current/). Group by surface.

### 1. Binary & Environment Management
- [ ] Detect installed `mongosync` binary (path config + auto-detect on `PATH`).
- [ ] Show installed mongosync version; warn if unsupported.
- [ ] Validate MongoDB source/destination major versions (must match for reverse; 6.0+ for reversible/sharded features).
- [ ] Configurable data directory (`~/.mongosync-ui/`) and per-migration log/metrics paths.

### 2. Connection Configuration (per migration)
- [ ] Two cluster connection strings: `cluster0` and `cluster1` (URI input + masked password).
- [ ] Designate which cluster is source vs destination (direction mapping).
- [ ] Test/validate connectivity to both clusters before start; surface ping latency.
- [ ] Store credentials securely; never log/echo passwords (warn about CLI password exposure — prefer config file).
- [ ] Optional named clusters (the `source`/`destination` names used by `/start`).

### 3. mongosync Process Options (CLI flags → generated config)
- [ ] `--port` — HTTP API port (auto-assign from 27182, one per migration).
- [ ] `--logPath` — log output directory.
- [ ] `--metricsLoggingFilepath` — metrics log directory; `--disableMetricsLogging` toggle.
- [ ] `--verbosity` — TRACE / DEBUG / INFO / WARN / ERROR / FATAL / PANIC.
- [ ] `--loadLevel` — 1–4 workload intensity (default 3).
- [ ] `--createIndexesBatchSize` — 1–64 index-build batch size.
- [ ] `--id` — instance identifier (shard ID; needed for multi-instance sharded sync).
- [ ] `--disableTelemetry` toggle.
- [ ] `--disableVerification` / `--acceptDisclaimer` (embedded verifier).
- [ ] `--enableCappedCollectionHandling` toggle.
- [ ] `--hotDocIDs` — hot (frequently-updated) document IDs for commit-stage copying.
- [ ] `--config` — generate and write the YAML config file (preferred over CLI flags for secrets).

### 4. Sync Start Options (`POST /start` body)
- [ ] `source` / `destination` cluster names.
- [ ] `reversible` (bool) — enable reverse-sync capability (6.0+; incompatible with filtering).
- [ ] `buildIndexes` — `afterDataCopy` | `beforeDataCopy` | `excludeHashed` | `excludeHashedAfterCopy` | `never`.
- [ ] `detectRandomId` (bool, default true) — natural-order copy for random `_id` collections.
- [ ] `copyInNaturalOrder` — explicit list of namespaces to copy in natural order.
- [ ] `preExistingDestinationData` (bool) — allow pre-existing destination namespaces.
- [ ] `verification.enabled` (bool) — embedded verifier on/off.

### 5. Namespace Filtering (`includeNamespaces` / `excludeNamespaces`)
- [ ] Build include/exclude filter lists in the form UI.
- [ ] Per-entry: `database` or `databaseRegex` {pattern, options}.
- [ ] Per-entry: `collections` array and/or `collectionsRegex` {pattern, options}.
- [ ] Enforce constraints: cannot edit filters after start; incompatible with reverse; cannot filter system namespaces.
- [ ] Helpful warnings for views, `mapReduce`/`$out`, and rename limitations.

### 6. Sharding (replica set → sharded cluster)
- [ ] `sharding.createSupportingIndexes` (bool).
- [ ] `sharding.shardingEntries[]` — per-collection {database, collection, shardCollection.key}.
- [ ] Multi-instance orchestration: one mongosync per shard with matching `--id`; broadcast identical API commands to all instances.

### 7. Lifecycle Actions (state-aware buttons)
- [ ] Start (`/start`) — only when IDLE.
- [ ] Pause (`/pause`) — only when RUNNING (empty body).
- [ ] Resume (`/resume`) — only when PAUSED.
- [ ] Commit (`/commit`) — gated on `canCommit: true` and low `lagTimeSeconds`; warn to stop source writes first.
- [ ] Reverse (`/reverse`) — only when COMMITTED and `reversible` was set; show prerequisite checks.
- [ ] Delete/remove migration; kill orphaned process; restart after server restart.
- [ ] Pre-commit checklist UI (lag near 0, writes stopped, canCommit true).

### 8. Live Monitoring / Charts (`GET /progress`, poll every 5s)
- [ ] State badge + `info` substate string + `canCommit` / `canWrite` indicators.
- [ ] Collection copy progress: `estimatedCopiedBytes` / `estimatedTotalBytes` (progress bar).
- [ ] Index building: `indexesBuilt` / `totalIndexesToBuild`, `collectionsFinished` / `collectionsTotal`.
- [ ] Change event application: `totalEventsApplied`, `lagTimeSeconds`, `estimatedSecondsToCEACatchup`.
- [ ] `estimatedOplogTimeRemaining` (oplog window) display + warning when low.
- [ ] Network: source/destination `pingLatencyMs`.
- [ ] `directionMapping` (current source → destination) — updates after reverse.
- [ ] `mongosyncID` / `coordinatorID`.
- [ ] `warnings[]` surfaced as alerts.
- [ ] Embedded verification panel: per-cluster phase, `scannedCollectionCount`/`totalCollectionCount`, `hashedDocumentCount`/`estimatedDocumentCount`, verification lag.
- [ ] Time-series charts (recharts): lag, bytes copied, events applied over time (persist polled samples to SQLite).

### 9. Logs
- [ ] Tail/view mongosync log output per migration (logs-panel).
- [ ] Filter by verbosity level; download/export logs.

### 10. Error Handling & Notifications
- [ ] Surface `/start` and action errors (`error` + `errorDescription`) as toasts.
- [ ] Detect/display API errors returned by `/progress`.
- [ ] Confirmation dialogs for destructive/irreversible actions (commit, reverse, delete).

### 11. Settings
- [ ] Global defaults for mongosync binary path, base port, data directory, poll interval.
- [ ] Default load level, verbosity, verification on/off, telemetry on/off.

## Conventions

- Keep files small and focused
- Use server actions for mutations where natural, API routes for polling/streaming
- Zod schemas are the source of truth for form validation and types
- No unnecessary abstractions — direct function calls over class hierarchies
- Error handling at API boundaries only — toast user-facing errors
