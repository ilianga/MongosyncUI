# Preflight readiness checks

Before you start a migration, run **Preflight** from the new migration form. It connects
to both clusters (via `mongosh`) and validates the conditions mongosync needs. Each check
returns **pass**, **warn**, **fail**, or **skip** (when a prerequisite could not be
read). Fix every **fail** before starting; review every **warn**.

The checks below are what the app verifies today. Balancer-state and destination
zone-tag checks for sharded clusters are on the roadmap — until they land, follow the
manual steps in the [sharded clusters runbook](./sharded-clusters.md).

## 1. Reachable (source and destination)

**Verifies:** a TCP connection to the cluster succeeds.

**Remediation:** check the host/port and that the cluster is running and accepts
connections.

## 2. Is a replica set (source and destination)

**Verifies:** the node belongs to a replica set (reads `setName`). mongosync requires a
replica set on **both** ends; a standalone fails.

**Remediation:** restart `mongod` with `--replSet <name>` and run `rs.initiate()`.

## 3. Credentials authenticate (source and destination)

**Verifies:** your credentials authenticate. Auth-style errors fail this check.

**Remediation:** check the username/password and `authSource` — mongosync expects
`authSource=admin`. If authorization is disabled (no users), the connection passes here
but the privileges check flags it (see below).

## 4. Required privileges (source and destination)

**Verifies:** the user holds the actions mongosync needs, or a built-in role that grants
them.

- **Source actions:** `find`, `changeStream`, `collStats`, `listCollections`,
  `listDatabases`.
- **Destination actions:** `enableSharding`, `insert`, `createCollection`,
  `bypassDocumentValidation`, `createIndex`, `dropCollection`, `dropDatabase`,
  `listCollections`, `listDatabases`.
- **Roles that satisfy the check outright:**
  - Source: `root`, `readAnyDatabase`, `backup`, `clusterMonitor`, `readWriteAnyDatabase`.
  - Destination: `root`, `readWriteAnyDatabase`, `restore`, `clusterManager`.

**Authorization disabled:** the destination **fails** (mongosync rejects a destination
with an empty privilege set); the source **warns** (mongosync usually accepts it, but
enabling auth is recommended).

**Remediation:**

- Destination: grant `clusterManager` + `readWriteAnyDatabase` + `clusterMonitor` +
  `backup` + `restore` (or `root` for local testing).
- Source: grant read roles (`readAnyDatabase` / `clusterMonitor` / `backup`), or `root`
  for local testing.
- Grant `clusterMonitor` on the **destination** to enable the live in-progress
  index-build panel.

## 4b. Destination can block writes (`bypassWriteBlockingMode`)

**Verifies:** the destination user holds **`setUserWriteBlockMode`** and
**`bypassWriteBlockingMode`** — mongosync enables user write-blocking on the destination at
commit and checks these at `/start`, exiting fatally without them.

This is a **separate** check from "Required privileges" and deliberately uses **no role
fallback except `root`** — no broad role reliably implies these actions. In particular,
Atlas's **`atlasAdmin` does not include `bypassWriteBlockingMode`**, so the general
privilege check can pass while this one (correctly) fails.

**Remediation:**

- **Atlas:** keep `atlasAdmin` and add a custom role with the `bypassWriteBlockingMode`
  action (see [troubleshooting.md](./troubleshooting.md#missing-privileges-bypasswriteblockingmode--atlas-destination)).
- **Self-managed:** use `root`, or a role granting both `setUserWriteBlockMode` and
  `bypassWriteBlockingMode`.

Skipped when the destination is unreachable or its privileges can't be read (auth
disabled — the Required-privileges check already fails that case).

## 5. Version compatibility (both)

**Verifies:** source and destination major versions.

- Equal majors → **pass**.
- Different majors with **reversible** enabled → **fail** (reverse needs equal majors).
- Different majors, one-way sync → **warn** (acceptable, but reversible/sharded features
  need 6.0+ and equal majors).

**Remediation:** match the major versions, or disable reversible.

## 6. Destination has no user data

**Verifies:** the destination has no user databases (system databases and mongosync's
internal databases are ignored).

- Empty → **pass**.
- Non-empty with **Allow pre-existing destination data** enabled → **warn**.
- Non-empty without that flag → **fail** (mongosync refuses a non-empty destination).

**Remediation:** enable **Allow pre-existing destination data**, or drop the existing
databases.

## 7. No leftover mongosync state on destination

**Verifies:** the destination does not have the `__mdb_internal_mongosync` bookkeeping
database from a previous run. If present, mongosync tries to **resume the old run**
instead of starting fresh, which is rarely what you want for a new migration. Returns
**warn** when found.

**Remediation:** use the **Drop sync state** action (calls
`POST /api/cluster-check/drop-sync-state`). This drops only mongosync's bookkeeping
database, not your user data.

## 8. Source oplog window

**Verifies:** the source oplog covers a healthy time window.

- ≥ ~1 hour → **pass**.
- < ~1 hour → **warn** (a small window risks the migration falling behind on a long
  run).

**Remediation:** increase the source oplog size for long-running migrations.

## When a check is skipped

A check is **skip** when its prerequisite could not be read — for example, the cluster is
unreachable (so replica-set/auth checks are skipped), or `mongosh` could not read a
particular value (privileges, versions, oplog window). Resolve the underlying reachability
or permission issue and re-run preflight.
