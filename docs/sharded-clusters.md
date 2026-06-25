# Sharded clusters runbook

This is a practical runbook for migrating **to or from sharded clusters** with mongosync,
based on the official
[mongosync sharded-cluster guidance](https://www.mongodb.com/docs/mongosync/current/reference/sharding/).

> **What MongosyncUI automates today vs. the roadmap**
>
> - **Automated today:**
>   - Single-instance sharded sync (one mongosync, one migration in the UI).
>   - The `sharding.shardingEntries` start option — per-collection shard keys for a
>     replica-set → sharded migration (see "Shard key configuration" below).
>   - Supervision, monitoring, charts, logs, and the lifecycle controls for that single
>     instance.
>   - Most preflight checks (reachability, replica set, auth, privileges, version,
>     destination-empty, leftover sync state, oplog window).
> - **Roadmap (do it manually for now):**
>   - **One-mongosync-per-source-shard** orchestration (multi-instance sync). The UI runs
>     one mongosync per migration; it does not yet broadcast identical commands to several
>     mongosync instances or assign per-shard `--id` values. For uneven or large sharded
>     migrations, run the per-shard instances from the CLI as below.
>   - **Balancer-state and destination zone-tag preflight checks.** Verify these by hand
>     until they ship.
>
> Use the UI for single-instance sharded syncs and for monitoring; use the CLI runbook
> below for multi-instance (one-per-shard) syncs.

## Two ways to sync a sharded cluster

1. **Single mongosync instance.** Simpler. Works for replica set → sharded, sharded →
   replica set, and small sharded → sharded migrations. This is what MongosyncUI drives
   today as one migration.
2. **One mongosync per source shard.** Higher throughput for larger sharded → sharded
   migrations. Each instance gets a distinct `--id` and you broadcast identical API
   commands to all of them. This is the manual/CLI path today.

## Even vs. uneven shard counts

- **Even (e.g. 4 → 4):** supports the one-per-source-shard topology and can be
  **reversible**.
- **Uneven (e.g. 4 → 2 or 2 → 4):** supported, but **not reversible**. Plan a one-way
  cutover.

## Critical prerequisites (do these first)

Before starting any sharded migration:

1. **Disable the destination balancer and wait ~15 minutes** for in-flight chunk moves to
   settle:
   ```js
   // on the destination mongos
   sh.stopBalancer()
   // wait ~15 minutes, then confirm no moveChunk is running
   ```
2. **Disable the source balancer** as well — **unless** you are using namespace filtering,
   in which case leave the source balancer as the docs direct for your case.
3. **Do not run** `moveChunk`, `shardCollection`, `moveRange`, `removeShard`, or other
   topology-changing operations on **either** cluster during the migration.
4. **Shard-key-compatible indexes** must exist for every collection you shard on the
   destination (mongosync can create supporting indexes — see below).
5. **Same mongosync version** across all instances in a multi-instance sync.
6. **Remove destination zone tags** (tag ranges / zones) before syncing; re-add them
   after cutover if you need them.

> MongosyncUI does **not** check balancer state or zone tags yet. Verify these manually.

## Shard key configuration (replica set → sharded)

When migrating a replica set to a sharded cluster, tell mongosync how to shard each
collection. In MongosyncUI, use the **Sharding** entries on the new migration form:

- **database**, **collection**, and a **shard key** expressed as
  `field:1, other:hashed` (each part is `field:<direction>`, where direction is `1`, `-1`,
  or `hashed`).

This generates the `sharding.shardingEntries[]` start option. The
`sharding.createSupportingIndexes` flag exists in the data model but is not exposed in the
form yet — if you need it, create the supporting indexes on the destination yourself
before starting.

## Multi-instance runbook (one mongosync per source shard) — manual / CLI

Run this from the shell today; UI orchestration is on the roadmap.

1. **List the source shards** and note each shard's identifier:
   ```js
   // on the source mongos
   db.getSiblingDB("admin").runCommand({ listShards: 1 })
   ```
2. **Start one mongosync per source shard.** Give each instance a distinct `--id` that
   matches a source shard, each on its own port, each with its own config file. For
   example:
   ```bash
   mongosync --config shard0.yaml   # contains: id: <shard0-id>, port: 27182, cluster0/cluster1 URIs
   mongosync --config shard1.yaml   # contains: id: <shard1-id>, port: 27183, ...
   # ...one per source shard
   ```
3. **Broadcast identical `/start` bodies** to every instance's HTTP API. The body must be
   the same for all instances:
   ```bash
   for port in 27182 27183 27184 27185; do
     curl -s -X POST "http://localhost:$port/api/v1/start" \
       -H 'Content-Type: application/json' \
       -d '{"source":"cluster0","destination":"cluster1"}'
   done
   ```
4. **Monitor every instance** (`GET /api/v1/progress` on each port). All instances must
   reach `canCommit: true`.
5. **Commit identically across all instances** once each reports `canCommit: true` and lag
   is near zero — and after you have **stopped application writes to the source**:
   ```bash
   for port in 27182 27183 27184 27185; do
     curl -s -X POST "http://localhost:$port/api/v1/commit" -d '{}'
   done
   ```
6. **Cut over** your application to the destination once all instances reach `COMMITTED`.

## After cutover

- **Re-enable the destination balancer** once the migration is `COMMITTED`:
  ```js
  sh.startBalancer()
  ```
- Re-add any **zone tags** you removed.
- Re-enable the **source balancer** if you intend to keep using the source.

## Single-instance sharded sync in MongosyncUI

For the single-instance path, you do not need any of the multi-instance CLI steps:

1. Complete the manual prerequisites above (balancer, zone tags, no topology changes).
2. Create a normal migration in the UI; if the destination is sharded and the source is a
   replica set, add **Sharding** entries for the collections you want sharded.
3. Run preflight, start, monitor, and commit using the UI lifecycle controls — see
   [migrations.md](./migrations.md).
4. Re-enable the destination balancer after `COMMITTED`.
