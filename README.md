# MongosyncUI

A local web UI for managing MongoDB cluster-to-cluster migrations via
[`mongosync`](https://www.mongodb.com/docs/mongosync/current/). Configure, start,
monitor, and cut over migrations from your browser — no manual API calls.

## Features

- **App login** — username/password gate (default `admin` / `admin`, changeable under Settings → Security).
- **Compass-style connection builder** per cluster: scheme/hosts, **TLS** (incl. self-signed CA + client-cert upload), and six auth methods — Username/Password (Default / SCRAM-SHA-1 / SCRAM-SHA-256 + auth database), X.509, Kerberos, LDAP, AWS IAM, and OIDC. A paste-a-connection-string escape hatch is always available.
- Create migrations with a guided form (namespace filters, sharding, verifier, and process options).
- State-aware lifecycle controls: **start / pause / resume / commit / stop / reverse / delete**. Commit is **gated on mongosync's `canCommit`** with the live lag shown so you know when cutover is safe.
- **Stop & resume** — tear a migration's process down to free resources and resume later from the destination-persisted state.
- Live monitoring polled every 5s: collection-copy progress, **live in-progress index builds** (read from the destination), change-event lag, `canCommit`, ping latency, and warnings.
- **Process health** — per-instance CPU %, memory (RSS), and uptime, alongside crash/hung supervision.
- **Accurate copy progress** — a stable total computed from the source, so progress never spikes to ~100% and drops back as mongosync revises its own estimate.
- Rich dashboard cards with an at-a-glance glimpse (progress, lag, canCommit, events, ETA, pings, resources).
- Time-series charts (lag, bytes copied, events applied, **CPU, memory**) persisted to SQLite.
- Auto-detects leftover mongosync state on the destination that blocks a fresh start and **offers to drop it** from the UI.
- Per-migration log viewer.
- One `mongosync` process per migration, each on its own auto-assigned port.

## Prerequisites

- **Node.js 20+** (Next.js 16 requires Node 18.18+; 20 LTS recommended).
- **npm** (ships with Node).
- **`mongosync` binary** installed and on your `PATH` (or set its path in the app's Settings page).
  See the [mongosync install guide](https://www.mongodb.com/docs/mongosync/current/installation/).
- **`tmux`** (recommended; enables fault tolerance and auto-restart of crashed instances).
- **`mongosh`** on your `PATH` — used for connectivity tests, source-size estimation, and reading
  in-progress index builds from the destination.
- Two reachable MongoDB clusters (a source and a destination) to migrate between. mongosync requires
  an **authenticated** user with cluster privileges on both — it cannot run against an auth-disabled
  deployment. For the live index-build view, the destination user also needs the **`clusterMonitor`**
  role (`$currentOp`/`inprog` privilege); it's already in mongosync's recommended role set. See
  `CLAUDE.md` for the full role list.

> **Note:** The app is protected by a username/password login (default **`admin` / `admin`** —
> change it under **Settings → Security**). It's still designed as a personal, localhost-only tool.
> If you ever expose it beyond localhost, set a strong `MSYNC_AUTH_SECRET` (the session-cookie
> signing secret) and change the default credentials.

## Getting started

```bash
# 1. Install dependencies
npm install

# 2. Start the dev server
npm run dev
```

Then open **http://localhost:3000**. You'll be asked to sign in — the default credentials are
**`admin` / `admin`**; change them under **Settings → Security**.

On first run, go to **Settings** to confirm the `mongosync` binary path (auto-detected from
`PATH` if available) and set defaults like base port, verbosity, and load level.

## Authentication

The app seeds **`admin` / `admin`** on first run and gates every page and API route behind a
signed-cookie session (verified in middleware). Change the username/password under
**Settings → Security**. The cookie is signed with `MSYNC_AUTH_SECRET`; a localhost dev fallback
is used if it's unset, so set a real value if the app isn't purely local.

## Connecting to clusters (TLS & auth)

Each cluster is configured with a Compass-style builder (source and destination):

- **Auth methods:** Username/Password (with **Default / SCRAM-SHA-1 / SCRAM-SHA-256** and an
  authentication database), **X.509**, **Kerberos**, **LDAP**, **AWS IAM**, and **OIDC**.
  OIDC is best-effort — interactive OIDC generally can't complete for an unattended `mongosync`
  process, so it only works with a machine/callback workflow.
- **TLS / self-signed CA:** enable TLS and **upload a CA PEM** (and, for X.509, a client
  certificate). An "allow invalid certificates" toggle exists for quick testing but is **off by
  default** and clearly marked insecure — supplying the CA is the recommended path.
- **Advanced:** a "paste connection string" escape hatch covers anything the form doesn't.

Uploaded certificates are stored under `~/.mongosync-ui/certs/` and referenced by path in the
generated config. Internally the structured config is rendered to a single MongoDB connection
string that both `mongosync` and the `mongosh`-based helpers consume.

## Data directory

All runtime data is stored under `~/.mongosync-ui/`:

- `data.db` — SQLite database (migrations, structured connection configs, login credentials, polled metric samples)
- `configs/` — generated `mongosync` YAML config files
- `certs/` — uploaded TLS CA / client-certificate PEMs (per migration, plus a `_staging/` area for uploads before a migration is created)
- `logs/` — per-migration log output
- `supervision/` — per-migration wrapper status + stop sentinels

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
and stores samples in SQLite for the charts. Every page and API route is gated by an
authentication middleware.

The poller also enriches what mongosync reports:

- **Copy progress** uses a stable total computed once from the source (sum of in-scope collection
  data sizes via `mongosh`), because mongosync's own `estimatedTotalBytes` starts low and jumps as
  it discovers data — which otherwise makes the progress bar spike to ~100% and fall back.
- **In-progress index builds** are read directly from the destination's `$currentOp` (mongosync's
  `/progress` only counts *completed* builds), giving live per-collection build progress.
- **Process health** (CPU %, RSS, uptime) is sampled from the OS by resolving each instance's PID
  (`pgrep` under supervision, or the stored PID in legacy mode) — complementing the crash/hung
  supervision below.

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
