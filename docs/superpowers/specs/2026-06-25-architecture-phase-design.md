# Architecture Phase — Design (sharded, multi-dest, balancer)

Locked decisions (from the user):
- **Sharded** → auto-managed under one migration (detect via `listShards`, spin N instances).
- **Multi-destination** → a migration *group* of independent syncs (source ≠ destination).
- **Balancer/zones** → semi-auto: detect + one-click + gate (user performs the admin actions).

Sequenced build (these share core files, so NOT all parallel):
- Round 1 (parallel, disjoint files): **Balancer semi-auto** + **Multi-destination groups**.
- Round 2 (solo, on integrated base): **Auto-managed sharded multi-instance**.

---

## 1. Balancer semi-auto (Round 1)
Preflight already detects balancer state + zone tags (`balancerState.*`, `shardZoneTags`) and a `fail` blocks Create & Start. This adds the *actions* and the post-commit re-enable, keeping the user in control (semi-auto).

- `src/lib/balancer.ts` (new): via the hardened `mongosh` runner against a cluster (mongos) URI — `getBalancerState(uri)`, `stopBalancer(uri)` (`sh.stopBalancer()`), `startBalancer(uri)` (`sh.startBalancer()`). Resilient (typed errors, never silent).
- `POST /api/cluster-check/balancer` (new, uses `api.ts`): `{ conn|uri, action: "state"|"disable"|"enable" }` → result. Masks secrets in errors.
- `preflight-report.tsx`: when a `balancerState` check is `fail`/`warn`, render a **"Disable balancer"** button that calls the action, with a clear note that chunk migrations need ~15 min to drain before starting; re-run preflight after.
- Detail page: when state is `COMMITTED`, show a **"Re-enable balancer"** affordance (destination, and source if it was disabled). One-click; no background job.
- Ownership: `src/lib/balancer.ts`, `src/app/api/cluster-check/balancer/route.ts`, `src/components/preflight-report.tsx`, `src/app/migrations/[id]/page.tsx`. NOT db/types/poller/card/dashboard/migrations-route.

## 2. Multi-destination groups (Round 1)
One source → N destinations, each a normal independent migration, grouped in the UI.

- DB/types: add nullable `groupName TEXT` (and a generated `groupId`) to `migrations` (additive `migrateSchema`). `Migration.groupName?`.
- `POST /api/migrations` accepts an optional `groupName` and stores it (success shape otherwise unchanged).
- New create flow `/migrations/new-multi` (page): pick one source + N destinations + shared config; on submit, POST `/api/migrations` once per destination with the same `groupName`; enforce **source ≠ each destination** (compare built connection strings/hosts) client-side + server-side.
- Dashboard (`page.tsx`): group migrations by `groupName` into a labelled group block with group-level summary; ungrouped render as today.
- `migration-card.tsx`: small group badge when `groupName` is set.
- Sidebar: optional "New multi-destination" entry (or a button on the dashboard).
- Ownership: `src/lib/db.ts`, `src/lib/types.ts`, `src/app/api/migrations/route.ts`, `src/app/migrations/new-multi/page.tsx` (new), `src/app/page.tsx`, `src/components/migration-card.tsx`, `src/components/app-shell/sidebar.tsx`, `src/lib/schemas.ts` if needed. NOT poller/preflight-report/detail-page/balancer.

## 3. Auto-managed sharded multi-instance (Round 2 — solo)
A single migration transparently runs **N mongosync instances**, one per *source* shard.

- Detect: on create, query the source mongos `listShards`; if sharded, this is a multi-instance migration with one instance per source shard (`--id <shardId>`, unique ports from basePort).
- Data model: an `instances` table (or `instances` JSON) — `{ id, migrationId, shardId, port, sessionName, status, pid }`. A non-sharded migration has exactly one implicit instance (preserve current behavior). Keep the single-instance path 100% working.
- `config-generator`: per-instance YAML (`id: <shardId>`, `port`, shared cluster0/cluster1 = source/dest **mongos**).
- `process-manager`/`supervisor`/`poller`: spawn/supervise/probe N sessions per migration; reconcile per instance; aggregate `/progress` across instances (copy = sum bytes; lag = max; `canCommit` = all; events = sum). Hung/crash detection per instance.
- Lifecycle: broadcast identical `/start` to all instances; `/commit` to all (blocking until every instance committed); `/pause`/`/resume`/`/stop` fan out. `reversible` only when source & destination shard counts match.
- UI: one card with aggregate progress + a per-shard breakdown on the detail page.
- Prerequisites surfaced via preflight (balancer off on both as required; same mongosync version; shard-key-compatible indexes; no zone tags; no resharding ops mid-migration).
- This reshapes the core process model, so it builds last on the integrated base.
