# MongosyncUI

> A local web UI for MongoDB cluster-to-cluster migrations — configure, run, monitor, and cut over without touching the `mongosync` API by hand.

[![CI](https://github.com/ilianga/MongosyncUI/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/ilianga/MongosyncUI/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

MongosyncUI wraps MongoDB's [`mongosync`](https://www.mongodb.com/docs/mongosync/current/)
in a browser dashboard. Build cluster connections with a Compass-style form (TLS + every
auth method), launch a migration, and watch live copy/index/lag progress with charts —
all from `localhost`. Each migration runs as its own supervised `mongosync` process that
auto-restarts on crash and survives an app restart.

## Features

- **Compass-style connection builder** per cluster: scheme/hosts, **TLS** (self-signed CA
  + client-cert upload), and six auth methods (Username/Password with SCRAM variants,
  X.509, Kerberos, LDAP, AWS IAM, OIDC) — plus a paste-a-connection-string escape hatch.
- **Guided migration form** with namespace filters, sharding, the embedded verifier, and
  process options, plus a **preflight readiness check** before you start.
- **State-aware lifecycle controls** — start / pause / resume / commit / stop / reverse /
  delete. Commit is gated on mongosync's `canCommit` with live lag shown so cutover is safe.
- **Live monitoring (5s poll)** — collection-copy progress (with a stable source-computed
  total so the bar doesn't spike), **in-progress index builds read from the destination**,
  change-event lag, ping latency, and warnings.
- **Process health & supervision** — per-instance CPU / memory / uptime, with automatic
  restart of crashed or hung instances (tmux-backed) and an optional boot service.
- **Time-series charts** (lag, bytes copied, events applied, CPU, memory) persisted to SQLite.
- **Stop & resume** to free resources and pick up later from destination-persisted state.
- **App login** and a per-migration log viewer.

## Prerequisites

- **Node.js 20+** and npm.
- **`mongosync`** on your `PATH` (or set its path in Settings) —
  [install guide](https://www.mongodb.com/docs/mongosync/current/installation/).
- **`mongosh`** on your `PATH` — connectivity tests, source-size estimation, live index-build reads.
- **`tmux`** (recommended) — enables crash/hung auto-restart and lets sessions survive an app restart.
- Two reachable, **authenticated** MongoDB clusters (source + destination). mongosync cannot
  run against an auth-disabled deployment; the destination user needs `clusterMonitor` for the
  live index-build view. See [`CLAUDE.md`](./CLAUDE.md) for the full role list.

## Quick start

```bash
npm install
npm run dev
```

Open **http://localhost:3000** and sign in with the default credentials **`admin` / `admin`**
(change them under **Settings → Security**). On first run, visit **Settings** to confirm the
`mongosync` binary path and defaults (base port, verbosity, load level).

For production:

```bash
npm run build
npm run start        # serves on localhost:3000 (use `-- -p <port>` to change)
```

## Configuration

Environment variables (all optional for a purely-local dev run — see [`.env.example`](./.env.example)):

| Variable | Required? | Description |
|---|---|---|
| `MSYNC_AUTH_SECRET` | **Required for any non-localhost use** | Secret used to sign the session cookie. A localhost dev fallback is used when unset, but unset secrets make sessions forgeable off-localhost. Generate with `openssl rand -hex 32`. |
| `MONGOSYNC_UI_DIR` | No | Override the data directory (default `~/.mongosync-ui`). |

The HTTP port is set via Next.js, not an env var: `npm run dev -- -p 4000` (or the same for `npm run start`).

## Architecture

- **Next.js (App Router) + TypeScript** front and back end. Every page and API route sits
  behind a signed-cookie auth middleware.
- **One supervised `mongosync` process per migration**, each on its own auto-assigned port.
  Connection strings and options are written to a YAML config file (never CLI flags, so
  passwords don't leak to process listings). Under tmux, each runs in a session
  (`msync-<id>`) with an auto-restart wrapper; the poller acts as a health monitor that
  restarts hung/crashed instances and re-drives `/start`. Without tmux it falls back to
  unsupervised processes.
- **SQLite** (`better-sqlite3`) stores migrations, structured connection configs, login
  credentials, and polled metric samples — zero-config, no extra services.
- **`mongosh` helpers** handle connectivity tests, source-size estimation, and reading
  in-progress index builds from the destination's `$currentOp`.
- **No WebSockets** — the client polls the API every 5s for live updates.

All runtime data lives under the data directory (`~/.mongosync-ui` by default): `data.db`,
`configs/`, `certs/`, `logs/`, and `supervision/`. It's created on first use; delete it to reset.

## Security

This is a personal, **localhost-first** tool with no multi-user model. If you run it anywhere
beyond your own machine:

- **Change the default `admin` / `admin` credentials** (Settings → Security).
- **Set a strong `MSYNC_AUTH_SECRET`** — the session cookie is forgeable without it.
- Be aware that **secrets and certificates are stored in the data directory** (`data.db`
  holds login credentials and connection configs; `certs/` holds uploaded TLS PEMs).
  Protect that directory accordingly and don't commit it.
- Prefer keeping the app bound to `localhost`; there is no built-in authorization beyond the
  single login.

## Screenshots

> _Screenshots coming soon._
>
> <!-- Add dashboard, migration form, and live-monitoring screenshots here. -->

## Tech stack

Next.js (App Router) · TypeScript · Tailwind CSS · recharts · react-hook-form + zod ·
better-sqlite3 · nanoid

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md) for setup, the test/lint/build
commands, code-style notes, and the PR flow.

## License

[MIT](./LICENSE) © 2026 Ilian Gagliardi
