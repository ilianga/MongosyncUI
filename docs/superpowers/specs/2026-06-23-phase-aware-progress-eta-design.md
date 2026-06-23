# Phase-Aware Progress + ETA — Design

## Goal
Replace the single ambiguous copy bar with a phase-aware view of where a migration is and
how long the current phase will take: **Copy → Index build → Catch-up (CEA) → Ready to
commit** (plus committing/committed/reversing). Surfaced as a compact glimpse on the
dashboard card and a fuller pipeline panel on the detail page.

## Architecture

### `src/lib/progress.ts` (pure, unit-tested)
`computeMigrationProgress(metrics: Metric[], state: MongosyncState, opts?): MigrationProgress`

- `Phase = "copy" | "index" | "cea" | "ready" | "committing" | "committed" | "reversing" | "idle"`
- `MigrationProgress = { phase: Phase; phaseLabel: string; phaseProgressPct: number | null; etaSec: number | null; detail: string; pipeline: { phase: Phase; label: string; state: "done"|"active"|"pending" }[] }`
- Phase determination (from latest metric + mongosync state):
  - `state === "COMMITTING"|"COMMITTED"|"REVERSING"` → that phase.
  - `canCommit` true → `ready`.
  - copyProgress < 100 → `copy`.
  - copy complete + indexes building (`totalIndexesToBuild > indexesBuilt`) → `index`.
  - copy complete + lag > 0 → `cea`.
- ETA:
  - **copy**: remaining bytes ÷ rolling-average throughput. Reuse `deriveRate` from
    `src/lib/format.ts` over the last N (e.g. 6) `estimatedCopiedBytes` samples to get a
    stable bytes/sec; `etaSec = (plannedTotalBytes||estimatedTotalBytes - copied) / rate`.
    Null if rate ≈ 0 or insufficient samples.
  - **cea**: `estimatedSecondsToCEACatchup` from the latest metric.
  - **index**: null (mongosync only reports completed builds; honest "in progress").
  - **ready/committed/etc.**: null.
- `phaseProgressPct`: copy → copyProgress; index → indexesBuilt/totalIndexesToBuild; cea →
  derived from lag trend (e.g. 100·(1 − lag/maxLagSeen)) clamped; ready → 100.
- Pure and side-effect free; no Date.now (derive timing from the metrics' own timestamps).

### Server enrichment — `GET /api/migrations` (`src/app/api/migrations/route.ts`)
Compute a COMPACT progress object from the last few metrics (`getMetrics` tail or a new
`getRecentMetrics(id, n)` helper in db.ts — additive) and attach
`progress: { phase, phaseLabel, phaseProgressPct, etaSec }` to each migration alongside the
existing `live`. This lets the card render phase + ETA without fetching the full series.

### Types — `src/lib/types.ts`
Add `MigrationProgress`/`Phase` (or a compact `ProgressGlimpse`) and an optional
`progress?` field on the `Migration` view object (mirroring how `live` is attached). Keep it
additive; do not change existing fields.

### UI
- **Card** (`migration-card.tsx`): add a phase line to the glimpse, e.g. `Copying · 44% · ~12m left`, `Building indexes · …`, `Catching up · lag 8s · ~3m`, `Ready to commit`. Use `formatDuration` for ETA. Render only when progress is present; keep all existing cells.
- **Detail** (`migrations/[id]/page.tsx`): a "Migration progress" pipeline panel (new
  `src/components/migration-progress.tsx`) showing the four phases with the active one
  highlighted, per-phase progress bar, and ETA — computed client-side via
  `computeMigrationProgress(metrics, state)` from the full series already fetched.

### Reuse
`deriveRate` (format.ts), `formatBytes`/`formatDuration`, the existing `Metric` fields
(`copyProgress`, `estimatedCopiedBytes`, `estimatedTotalBytes`, `lagTimeSeconds`,
`estimatedSecondsToCEACatchup`, `indexesBuilt`, `totalIndexesToBuild`, `canCommit`,
`timestamp`) and `migration.plannedTotalBytes`.

### Testing
Thorough unit tests for `computeMigrationProgress`: mid-copy with rising bytes → copy phase
+ finite ETA; copy done + lag>0 → cea phase + mongosync ETA; canCommit → ready; committing/
committed states; empty/insufficient metrics → `idle`/null ETA; ETA null when throughput ≈ 0.

## File ownership (for parallel build)
Owns/edits: `src/lib/progress.ts` (new), `src/lib/types.ts` (additive), `src/lib/db.ts`
(optional `getRecentMetrics` helper, additive), `src/app/api/migrations/route.ts` (GET
enrichment only — do NOT touch POST create), `src/components/migration-card.tsx`,
`src/app/migrations/[id]/page.tsx`, `src/components/migration-progress.tsx` (new), plus
tests. Does NOT touch `preflight.ts`, `/api/preflight`, `preflight-report.tsx`, or
`migration-form.tsx` (the preflight agent owns those).
