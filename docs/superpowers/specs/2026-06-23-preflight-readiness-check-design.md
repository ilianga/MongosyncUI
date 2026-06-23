# Preflight Readiness Check — Design

## Goal
Before a migration starts, validate everything that commonly makes `mongosync` fail at
init (auth, privileges, replica-set, leftover state, etc.) and present a clear pass/warn/fail
report instead of a cryptic crash. Auto-runs on **Create & Start** (hard failures block,
warnings allow "Create anyway") and is re-runnable on demand.

## Architecture

### `src/lib/preflight.ts` (pure orchestrator + thin check runners)
`runPreflight({ sourceUri, destUri, config }): Promise<PreflightReport>`

- `PreflightCheck = { id: string; label: string; side: "source"|"destination"|"both"; status: "pass"|"warn"|"fail"|"skip"; detail: string; remediation?: string }`
- `PreflightReport = { checks: PreflightCheck[]; overall: "pass"|"warn"|"fail" }`
- `overall` = `fail` if any check is `fail`, else `warn` if any `warn`, else `pass`.
- Every check is resilient: an exception → a `skip`/`warn` check with the error message; the
  report never throws.
- **Performance:** gather raw facts per cluster in ONE `mongosh` eval per side
  (`db.hello()`, `db.version()`, `connectionStatus({showPrivileges:true})`,
  `listDatabases`, oplog stats) — then derive checks from those facts. Use the
  `execFile`/`promisify` pattern from `src/lib/cluster-check.ts`. Reuse
  `buildConnectionString`/`getConnection` so structured connections work.

### Checks (full set)
1. **reachable** (per side) — TCP probe + mongosh ping. `fail` if unreachable. (reuse `tcpProbe` from cluster-check)
2. **replicaSet** (per side) — `db.hello().setName` present. `fail` if standalone — mongosync requires a replica set on both ends. Remediation: start `mongod --replSet` + `rs.initiate()`.
3. **authenticated** (per side) — the supplied creds authenticate. `fail` on auth error.
4. **privileges** (per side) — read `connectionStatus.authInfo.authenticatedUserPrivileges` and compare to the required action set for that side (see `comparePrivileges`). `fail` if required actions are missing. Special case: authorization disabled → empty privileges (note that mongosync still rejects the *destination* in that state). Remediation: grant `clusterManager`+`readWriteAnyDatabase`+`clusterMonitor`+`backup`+`restore` (dest), read roles (source); or use `root` for local testing.
5. **versionCompatibility** — read both major versions. `fail` if they differ **and** `config.reversible` is set (reverse needs equal majors); else `warn` if they differ; `pass` if equal. Note 6.0+ needed for reversible/sharded.
6. **destinationEmpty** — list non-system DBs on destination. If non-empty and `config.preExistingDestinationData` is not set → `fail` (mongosync refuses a non-empty destination). Remediation: enable "Allow pre-existing destination data" or drop the data.
7. **leftoverSyncState** — `__mdb_internal_mongosync` present on destination → `warn`. Remediation: the existing "drop sync state" flow (`/api/cluster-check/drop-sync-state`).
8. **oplogWindow** (source) — read oplog window (e.g. from `db.getReplicationInfo()` / `local.oplog.rs` first/last ts). `warn` if small (< ~1h) for long migrations.

### Pure, unit-tested units
- `comparePrivileges(have: Privilege[], requiredActions: string[]): { missing: string[] }` — `have` is `authenticatedUserPrivileges` (each `{resource, actions}`); compute the set of granted actions on the relevant resource (AnyDB / cluster) and return missing required actions. Role-based fallback: if `authenticatedUserRoles` contains a sufficient built-in role, treat as satisfied.
- `summarize(checks): overall` — severity rollup.
- Required-action constants live in one place: `REQUIRED_ACTIONS = { source: [...], destination: ["enableSharding","insert","createCollection","bypassDocumentValidation",...] }` (from mongosync docs).

### API
`POST /api/preflight` — body `{ sourceConn|sourceUri, destConn|destUri, config }` → `runPreflight` → returns `PreflightReport`. Auth-gated by existing middleware. Build URIs from structured conns via `buildConnectionString`.

### UI
- `src/components/preflight-report.tsx` — self-contained: given a `PreflightReport` (or a `run()` trigger), renders rows with pass/warn/fail icons, detail, and remediation. Also expose a `PreflightDialog`/panel wrapper that can be dropped anywhere (used by the wizard now; the detail page later).
- **Wizard** (`migration-form.tsx`): a "Run preflight" button shows the report inline. On **Create & Start**, run preflight first; if `overall === "fail"`, block and show the report; if `warn`-only, show it and offer "Create anyway" (proceed). `pass` → proceed directly.

### Error handling
At API boundary only; individual checks degrade to `skip`/`warn` with the raw error text.

### Testing
Unit tests for `comparePrivileges` (missing actions, role fallback, auth-disabled empty set), `summarize` (severity rollup), and the report shape. Check-runners stay thin; mongosh interaction isn't unit-tested (consistent with the repo).

## File ownership (for parallel build)
Owns/creates: `src/lib/preflight.ts`, `src/app/api/preflight/route.ts`, `src/components/preflight-report.tsx`, edits `src/components/migration-form.tsx`, plus tests. Keeps its types in `preflight.ts`. Does NOT touch the detail page, `/api/migrations` route, `migration-card.tsx`, `types.ts`, `db.ts`, or `progress.ts` (the progress agent / integrator own those).
