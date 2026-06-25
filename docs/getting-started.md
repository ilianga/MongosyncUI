# Getting started

This guide takes you from a clean checkout to your first running migration.

## 1. Prerequisites

- **Node.js 20+** and npm.
- **`mongosync`** on your `PATH`, or its path set in Settings —
  [install guide](https://www.mongodb.com/docs/mongosync/current/installation/).
- **`mongosh`** on your `PATH` — used for connectivity tests, source-size estimation,
  and reading live index builds from the destination.
- **`tmux`** (recommended) — enables crash/hung auto-restart and lets supervised
  mongosync sessions survive an app restart. Without tmux, the app falls back to
  unsupervised (legacy) processes.
- Two reachable, **authenticated** MongoDB replica sets (source + destination).
  mongosync cannot run against an auth-disabled deployment.

## 2. Install and run

```bash
npm install
npm run dev          # dev server on http://localhost:3000
```

For production:

```bash
npm run build
npm run start        # serves on localhost:3000
```

Change the port with the Next.js flag (there is no port env var):

```bash
npm run dev -- -p 4000
npm run start -- -p 4000
```

## 3. First login

Open **http://localhost:3000**. You are redirected to the login page.

- Default credentials: **`admin` / `admin`**.
- Change them under **Settings → Security** (you must supply the current password).
- If you run the app anywhere other than your own machine, set a strong
  `MSYNC_AUTH_SECRET` first — the session cookie is forgeable without it. See
  [configuration.md](./configuration.md).

## 4. Confirm the mongosync binary

Go to **Settings → Mongosync binary**.

- Leave the path blank to use `mongosync` from your `PATH`.
- Or enter a full path to the executable (or a directory containing it).
- Click **Test** to verify the binary and read its version. Settings are also
  verified automatically when you save.

While you are here, review the **New migration defaults** (load level, verbosity,
verification, telemetry) and **Process & polling** (base port, poll interval).
See [configuration.md](./configuration.md) for every setting.

## 5. Create your first migration

1. From the dashboard, click **New migration**.
2. Give it a **name**.
3. Build the **source** and **destination** connections. Use the structured
   connection builder (scheme, hosts, auth, TLS) or paste a connection string.
   See [connections.md](./connections.md).
4. (Optional) Set sync options: reversible, index build timing, verifier,
   namespace filters, sharding. See [migrations.md](./migrations.md) and
   [filtering.md](./filtering.md).
5. Click **Run preflight check** to validate both clusters (reachability, replica
   set, auth, privileges, version, empty destination, leftover sync state, oplog
   window). Fix any blocking issues. See [preflight.md](./preflight.md).
6. Create the migration, then press **Start** on its detail page.

## 6. Watch it run

The migration detail page polls mongosync every 5s and shows phase-aware progress,
ETAs, live index builds, process resources (CPU / memory / uptime), charts, and the
mongosync log. When lag is near zero and mongosync reports `canCommit: true`, the
**Commit** button unlocks for cutover. See [migrations.md](./migrations.md).

## Next steps

- [Connections and authentication](./connections.md)
- [Migration lifecycle and monitoring](./migrations.md)
- [Preflight checks](./preflight.md)
- [Namespace filtering](./filtering.md)
- [Sharded clusters runbook](./sharded-clusters.md)
- [Configuration](./configuration.md)
- [Troubleshooting](./troubleshooting.md)
