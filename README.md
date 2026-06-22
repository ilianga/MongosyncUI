# MongosyncUI

A local web UI for managing MongoDB cluster-to-cluster migrations via
[`mongosync`](https://www.mongodb.com/docs/mongosync/current/). Configure, start,
monitor, and cut over migrations from your browser — no manual API calls.

## Features

- Create migrations with a guided form (connection strings, namespace filters, sharding, verifier, and process options).
- State-aware lifecycle controls: **start / pause / resume / commit / reverse / delete**.
- Live monitoring polled every 5s: collection-copy progress, index builds, change-event lag, ping latency, and warnings.
- Time-series charts (lag, bytes copied, events applied) persisted to SQLite.
- Per-migration log viewer.
- One `mongosync` process per migration, each on its own auto-assigned port.

## Prerequisites

- **Node.js 20+** (Next.js 16 requires Node 18.18+; 20 LTS recommended).
- **npm** (ships with Node).
- **`mongosync` binary** installed and on your `PATH` (or set its path in the app's Settings page).
  See the [mongosync install guide](https://www.mongodb.com/docs/mongosync/current/installation/).
- **`tmux`** (recommended; enables fault tolerance and auto-restart of crashed instances).
- Two reachable MongoDB clusters (a source and a destination) to migrate between.

> **Note:** This is a personal, localhost-only tool — no authentication. Don't expose it to a network.

## Getting started

```bash
# 1. Install dependencies
npm install

# 2. Start the dev server
npm run dev
```

Then open **http://localhost:3000**.

On first run, go to **Settings** to confirm the `mongosync` binary path (auto-detected from
`PATH` if available) and set defaults like base port, verbosity, and load level.

## Data directory

All runtime data is stored under `~/.mongosync-ui/`:

- `data.db` — SQLite database (migrations + polled metric samples)
- `configs/` — generated `mongosync` YAML config files
- `logs/` — per-migration log output

This directory is created automatically on first use. To reset everything, stop the server and delete it.

## Available scripts

| Command | Description |
|---|---|
| `npm run dev` | Start the dev server at `localhost:3000` (hot reload). |
| `npm run build` | Production build. |
| `npm run start` | Run the production build (run `npm run build` first). |
| `npm run lint` | Lint with ESLint. |
| `npm test` | Run the test suite once (Vitest). |
| `npm run test:watch` | Run tests in watch mode. |

## Production

```bash
npm run build
npm run start   # serves on localhost:3000
```

## How it works

The UI spawns one `mongosync` process per migration and proxies lifecycle commands to each
process's HTTP API at `http://localhost:{port}/api/v1/`. Connection strings and options are
written to a YAML config file (never passed as CLI flags, so passwords don't leak to process
listings). A background poller queries `/progress` every 5 seconds while the server is running
and stores samples in SQLite for the charts.

By default each `mongosync` process runs in a supervised tmux session with auto-restart on crash.
The app's poller acts as a health monitor, detecting hung or crashed instances and relaunching them
with configurable backoff. Sessions survive an app restart; you can reconnect to a live instance
via `tmux attach -t msync-<migration-id>`.

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

## Tech stack

Next.js 16 (App Router) · TypeScript · Tailwind CSS · recharts · react-hook-form + zod ·
better-sqlite3 · nanoid

## License

Private / personal use.
