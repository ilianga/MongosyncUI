# Troubleshooting

Common errors and how to fix them. For pre-start validation, run the
[preflight check](./preflight.md) first — it catches most of these before you start.

## "Unauthorized" / "not authorized" / "Missing privileges"

mongosync rejects a cluster whose user lacks the required actions, or a destination with
authorization disabled.

- Confirm `authSource` is `admin` in the connection.
- Grant the destination user `clusterManager` + `readWriteAnyDatabase` + `clusterMonitor`
  + `backup` + `restore` (or `root` for local testing).
- Grant the source user read roles (`readAnyDatabase` / `clusterMonitor` / `backup`).
- Grant `clusterMonitor` on the **destination** so the live index-build panel works.
- A destination with **authorization disabled** is rejected — enable auth and connect as
  a privileged user.

See [preflight.md](./preflight.md#4-required-privileges-source-and-destination) for the
exact action lists.

## "NotAReplicaSet" / standalone node detected

mongosync requires a replica set on **both** source and destination.

```bash
# restart mongod with a replica set name, then:
mongosh --eval 'rs.initiate()'
```

A single-node replica set is fine for testing.

## Leftover `__mdb_internal_mongosync` state on the destination

If a previous run left mongosync's bookkeeping database behind, mongosync resumes the old
run instead of starting fresh. Preflight flags this as a warning.

- Use the **Drop sync state** action on the preflight panel
  (`POST /api/cluster-check/drop-sync-state`). It drops only mongosync's internal database,
  not your user data.

## Destination is not empty

mongosync refuses a destination that already has user databases.

- Enable **Allow pre-existing destination data** on the migration form, **or**
- Drop the existing databases on the destination.

## mongosync binary not found

- Set the binary path in **Settings → Mongosync binary** (full path or directory), or put
  `mongosync` on your `PATH`.
- Click **Test** to confirm the version is read.
- Check `GET /api/health` — `mongosyncDetected` reflects whether a path is configured.

## Balancer not stopped (sharded clusters)

For sharded migrations you must stop the destination balancer (and usually the source
balancer) before starting, and wait ~15 minutes for chunk moves to settle. The app does
**not** check balancer state yet.

```js
// on the relevant mongos
sh.stopBalancer()
// wait ~15 min, confirm no moveChunk is running, then start the migration
sh.startBalancer()   // re-enable only after the migration is COMMITTED
```

See the [sharded clusters runbook](./sharded-clusters.md).

## mongosync keeps restarting (crash loop)

Under supervised mode, a repeatedly crashing instance hits the crash-loop cap
(`crashLoopMax` crashes within `crashLoopWindowSec`) and stops, showing `crash_looping`.

- Check the **process** log stream for the crash output
  (`~/.mongosync-ui/logs/<id>/stdout.log`).
- Fix the underlying cause (bad URI, auth, unreachable cluster), then use **Retry** to
  reset the counter and respawn.
- Tune the thresholds in **Settings → Supervision & fault tolerance**.

## Instance marked hung / auto-restarted

The poller restarts an instance after `hungTicks` consecutive unreachable `/progress`
probes (default 6 ≈ 30s). If this happens often, the process may be overloaded — lower the
**load level**, or raise `hungTicks` in Settings.

## Auto-restart / boot recovery not working

- Auto-restart requires **tmux**. Without it, the app runs in legacy (unsupervised) mode.
  Install tmux and set `supervisionMode` to `supervised`.
- For recovery after a reboot, install the **boot service** (Settings) and run the
  follow-up command it shows. See [configuration.md](./configuration.md#boot-service).

## Sessions forgeable / login issues off-localhost

Set a strong `MSYNC_AUTH_SECRET` before exposing the app beyond localhost. Without it, the
session cookie uses a known dev fallback and is forgeable. See
[configuration.md](./configuration.md#environment-variables).

## Connection test fails but the cluster is up

- For self-signed / private-CA TLS, upload the **CA certificate** in the connection
  builder rather than disabling certificate validation.
- For `mongodb+srv`, make sure DNS SRV records resolve from the machine running the app.
- The Test button needs `mongosh` on the `PATH`.
