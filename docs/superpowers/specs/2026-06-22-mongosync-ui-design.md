# MongosyncUI Design Spec

A local web UI for managing MongoDB cluster-to-cluster migrations using the mongosync tool.

## Overview

MongosyncUI is a Next.js full-stack application that generates mongosync configurations, launches and manages mongosync processes, and provides live monitoring with historical metrics. It runs locally as `localhost:3000` and targets a single user managing multiple simultaneous migrations.

## Tech Stack

- **Framework:** Next.js 14+ (App Router)
- **UI:** React, Tailwind CSS, shadcn/ui
- **Charts:** recharts
- **Forms:** react-hook-form + zod
- **Database:** SQLite via better-sqlite3
- **Process management:** node:child_process.spawn()
- **Language:** TypeScript throughout

## Architecture

```
Browser  <-->  Next.js API Routes  <-->  mongosync processes (one per migration)
                      |
               SQLite (local file)
```

Three layers:

1. **UI Layer** — React pages with Tailwind + shadcn/ui components
2. **API Layer** — Next.js API routes handling process spawning, command proxying, metric polling, config generation
3. **Storage Layer** — SQLite at `~/.mongosync-ui/data.db`

Each migration gets its own mongosync process on a unique port (auto-assigned starting from 27182). A single `setInterval` in the API layer polls `/progress` on each active migration (default 5s) and writes metric snapshots to SQLite.

Config YAML files are written to `~/.mongosync-ui/configs/`. All data lives in `~/.mongosync-ui/`.

On app startup: check all migrations with a stored PID — if the process is dead, update state accordingly. Polling only runs while the Next.js server is running.

## Pages

### 1. Dashboard (`/`)

- List of all migrations as cards or table rows
- Each shows: name, source -> destination, current state badge (IDLE/RUNNING/PAUSED/COMMITTING/COMMITTED/REVERSING), progress bar
- Quick action buttons per migration (contextual to state)
- "New Migration" button

### 2. New Migration (`/migrations/new`)

Single-page form (no multi-step wizard):

- **Name** — label for this migration
- **Source cluster URI** — MongoDB connection string
- **Destination cluster URI** — MongoDB connection string
- **Sync options** — toggles: reversible, enableUserWriteBlocking, buildIndexes (never/always)
- **Filtering** (collapsible section) — includeNamespaces / excludeNamespaces as dynamic add/remove rows, each row has `database` and optional `collection` fields (regex supported)
- **Advanced** (collapsible section) — loadLevel slider (1-5, default 3), verification toggle, hotDocuments patterns

Submit saves config to DB, writes YAML config file, spawns mongosync, calls `/start`.

### 3. Migration Detail (`/migrations/[id]`)

- Live state display + progress from client-side polling (5s interval via setInterval + fetch)
- 4 recharts line charts:
  - Progress % over time
  - Lag time (seconds) over time
  - Events applied over time
  - Bytes copied vs total over time
- Action buttons contextual to current state (see state table below)
- Logs panel — tails the mongosync log file via API route, auto-scrolls

### 4. Settings (`/settings`)

- Mongosync binary path (editable text input)
- "Download" link to official MongoDB download page
- "Test" button — runs `mongosync --version`, displays result
- Default poll interval
- Data directory path display

## State-Aware Actions

| State      | Available Actions              |
|------------|--------------------------------|
| IDLE       | Start, Delete                  |
| RUNNING    | Pause, Commit (if canCommit), Delete |
| PAUSED     | Resume, Delete                 |
| COMMITTING | (none — waiting)               |
| COMMITTED  | Reverse, Delete                |
| REVERSING  | (none — waiting)               |

## Data Model (SQLite)

### migrations

| Column    | Type    | Notes                              |
|-----------|---------|------------------------------------|
| id        | TEXT PK | nanoid                             |
| name      | TEXT    |                                    |
| sourceUri | TEXT    |                                    |
| destUri   | TEXT    |                                    |
| config    | TEXT    | Full JSON of all /start options    |
| state     | TEXT    | Last known mongosync state         |
| port      | INTEGER | Assigned HTTP API port             |
| pid       | INTEGER | Nullable, OS process ID            |
| createdAt | INTEGER | Unix timestamp                     |
| updatedAt | INTEGER | Unix timestamp                     |

### metrics

| Column              | Type    | Notes                |
|---------------------|---------|----------------------|
| id                  | INTEGER | Autoincrement PK     |
| migrationId         | TEXT    | FK to migrations.id  |
| state               | TEXT    |                      |
| progress            | REAL    | 0-100                |
| lagTimeSeconds      | REAL    |                      |
| totalEventsApplied  | INTEGER |                      |
| estimatedCopiedBytes| INTEGER |                      |
| estimatedTotalBytes | INTEGER |                      |
| timestamp           | INTEGER | Unix timestamp       |

### settings

| Column | Type    | Notes       |
|--------|---------|-------------|
| key    | TEXT PK |             |
| value  | TEXT    |             |

## Mongosync Binary Management

- On first run, check common paths and PATH for `mongosync`
- Settings page: editable binary path, "Download" link to MongoDB site, "Test" button runs `mongosync --version`
- Store detected version in settings, display on Settings page and Dashboard header
- No auto-installation, no platform detection

## Mongosync API Reference (proxied by the UI)

All endpoints are `POST` to the mongosync HTTP API (default port 27182).

### POST /api/v1/start
Starts sync. Body includes: `source` (cluster0/cluster1), `destination`, `reversible`, `enableUserWriteBlocking`, `buildIndexes`, `includeNamespaces`, `excludeNamespaces`, `verification`, `hotDocuments`, `preExistingDestinationData`.

### POST /api/v1/pause
Pauses sync. Empty body `{}`.

### POST /api/v1/resume
Resumes paused sync. Empty body `{}`.

### POST /api/v1/commit
Commits sync (finalizes cutover). Empty body `{}`.

### POST /api/v1/reverse
Reverses committed sync direction. Empty body `{}`.

### GET /api/v1/progress
Returns sync state, progress, lagTimeSeconds, totalEventsApplied, estimatedCopiedBytes, estimatedTotalBytes, canCommit, and more.

## Mongosync States

IDLE -> RUNNING -> PAUSED (optional) -> COMMITTING -> COMMITTED -> REVERSING (optional) -> RUNNING

Most transitions are triggered by API calls. COMMITTING->COMMITTED and REVERSING->RUNNING happen automatically.

## Supported Topologies

- Replica Set -> Replica Set
- Replica Set -> Sharded Cluster
- Sharded Cluster -> Sharded Cluster
- NOT: Sharded Cluster -> Replica Set

For sharded sources, multiple mongosync instances are needed (one per shard), each with an `id` matching the shard ID.

## Mongosync Configuration File (YAML)

Generated per migration at `~/.mongosync-ui/configs/{migrationId}.yaml`:

```yaml
cluster0: "mongodb://..."
cluster1: "mongodb://..."
logPath: "~/.mongosync-ui/logs/{migrationId}"
port: 27183
verbosity: "INFO"
loadLevel: 3
```

## Non-Goals

- No authentication or user management
- No dark mode or themes
- No responsive/mobile layout (desktop browser only)
- No WebSockets (simple polling is sufficient)
- No auto-installation of mongosync binary
- No daemon or background service
