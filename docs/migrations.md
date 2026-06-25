# Migrations: lifecycle and monitoring

Each migration is one supervised `mongosync` process on its own auto-assigned port. This
guide covers the sync options you set when creating a migration, the state-aware
lifecycle controls, live monitoring, and how to commit, reverse, or stop and resume.

## Sync options (on the new migration form)

| Option | Field | Default | Notes |
|---|---|---|---|
| Reversible | `reversible` | off | Enables later reverse sync. **Incompatible with namespace filtering.** |
| Build indexes | `buildIndexes` | `beforeDataCopy` | `afterDataCopy` / `beforeDataCopy` / `excludeHashed` / `excludeHashedAfterCopy` / `never`. |
| Detect random `_id` | `detectRandomId` | on | Copies random-`_id` collections in natural order. |
| Pre-existing destination data | `preExistingDestinationData` | off | Allow non-empty destination namespaces. |
| Verification | `verificationEnabled` | off | Embedded verifier on/off. |
| Load level | `loadLevel` | 3 | 1 (gentlest) – 4 (fastest). |
| Verbosity | `verbosity` | `INFO` | `TRACE`…`PANIC`. |
| Namespace filters | include / exclude | none | See [filtering.md](./filtering.md). |
| Sharding entries | `shardingEntries` | none | See [sharded clusters](./sharded-clusters.md). |

Defaults for load level, verbosity, verification, and telemetry come from
**Settings → New migration defaults**.

## Lifecycle: states and actions

The migration moves through these states (driven by mongosync's reported state):

```
IDLE -> RUNNING -> PAUSED (optional) -> COMMITTING -> COMMITTED -> REVERSING (optional) -> RUNNING
```

The action buttons are state-aware. Available actions per state:

| State | Buttons shown |
|---|---|
| `IDLE` | **Start**, Delete |
| `RUNNING` | **Pause**, **Commit**, **Stop**, Delete |
| `PAUSED` | **Resume**, **Stop**, Delete |
| `COMMITTING` | Delete |
| `COMMITTED` | **Reverse**, Delete |
| `REVERSING` | Delete |

If a migration has been **stopped** (process torn down), only **Restart** and **Delete**
are available regardless of mongosync state.

### Start

Available when `IDLE`. Sends `/start` to the mongosync process and marks the migration
`RUNNING`. The app also computes the source data size at start (in parallel) to drive a
stable copy-progress bar.

### Pause / Resume

`Pause` (RUNNING → PAUSED) and `Resume` (PAUSED → RUNNING) call mongosync's `/pause` and
`/resume`. The mongosync process keeps running; only the sync is paused. For long pauses,
increase the source oplog size so the migration can catch up afterward.

### Commit (cutover)

Available from `RUNNING`. **Commit** is the cutover step. It is gated on mongosync
reporting `canCommit: true`; the button is disabled until then and the API re-checks
before sending, returning an error if commit is not yet possible.

Before you commit:

- **Stop application writes to the source.** Writing during commit risks data loss.
- Confirm **lag is near zero** (shown live on the page).
- Confirm **`canCommit` is true**.

Commit transitions `RUNNING -> COMMITTING -> COMMITTED`. The final step is automatic,
based on lag. After `COMMITTED`, the source is write-blocked and the destination is
writable — point your application at the destination.

### Reverse

Available from `COMMITTED`, and only if the migration was started with **reversible**
enabled. The app rejects reverse if the state is not `COMMITTED` or the config was not
reversible. Reverse swaps source and destination and resumes
(`COMMITTED -> REVERSING -> RUNNING`). mongosync has additional prerequisites (same shard
count and major version, destination oplog not rolled over, not used with filtered sync).

### Stop and Restart (resume later)

**Stop** is distinct from Pause. It tears down the mongosync process to free resources
while keeping the migration record and the sync state persisted on the destination. A
stopped migration shows **Restart**, which:

1. Respawns the mongosync process.
2. Waits up to ~30s for it to become ready (and aborts if it crash-loops on restart).
3. Re-issues `/start`; mongosync detects the persisted destination state and continues
   from where it left off.

Use Stop/Restart to reclaim CPU and memory between work sessions, or after a machine
reboot when the boot service brings the app back up.

### Delete

Available from any state. Tears down the process and **removes the migration record**.
This is the opposite of Stop (which keeps the record). It does not drop any data on your
clusters.

## Supervision and fault tolerance

Under tmux (the default), each migration runs in a session named `msync-<id>` behind a
respawn wrapper:

- **Crash → auto-restart** with exponential backoff (starts at 2s, doubles, capped at
  `backoffCapSec`, default 60s).
- **Crash-loop cap** — after `crashLoopMax` crashes (default 5) within
  `crashLoopWindowSec` (default 300s), the wrapper stops and the migration is marked
  `crash_looping`. Use **Retry** to reset and respawn.
- **Hung detection** — the poller marks an instance hung after `hungTicks` consecutive
  unreachable `/progress` probes (default 6 ≈ 30s at the 5s poll interval) and restarts
  it.
- **Reconciliation** — on every poll tick the app reconciles desired vs actual state:
  it restarts missing sessions, re-drives `/start` on respawned binaries, and cleans up
  sessions for deleted migrations.

Set `supervisionMode` to `legacy` (Settings) to use plain detached processes with no
auto-restart. The app also falls back to legacy automatically when tmux is missing.

To keep the app (and therefore reconciliation) running across reboots, install the
**boot service** from Settings — a launchd agent on macOS or a systemd `--user` unit on
Linux. See [configuration.md](./configuration.md).

Supervision tuning lives in **Settings → Supervision & fault tolerance**:
`supervisionMode`, `hungTicks`, `backoffCapSec`, `crashLoopMax`, `crashLoopWindowSec`.

## Live monitoring

The detail page polls every 5s (configurable via `pollInterval`).

### Phase-aware progress and ETA

The app classifies the migration into a pipeline: **Copy → Index build → Catch-up →
Ready**, and shows the active phase with a progress percentage and, where it can, an ETA.

- **Copy** — uses a stable denominator (the source data size computed at start) so the
  bar does not spike when mongosync's own estimate jumps. ETA is derived from recent copy
  throughput; it shows no ETA when throughput is stalled or there is too little signal.
- **Index build** — shows index-build progress; ETAs are not estimated for this phase.
- **Catch-up (CEA)** — tracks change-event lag against the peak lag seen, so you can see
  it converge toward zero.
- **Ready** — shown when mongosync reports `canCommit: true`.

### Live index builds

mongosync's `/progress` only counts **completed** index builds, so it shows `0 of N` for
the whole build phase. MongosyncUI reads **in-progress** builds from the destination's
`$currentOp` (via `mongosh`) and shows per-namespace scan progress. This requires
`mongosh` and a destination user with `clusterMonitor` (otherwise the panel is omitted).

### Process resources

Per-instance **CPU %**, **resident memory (RSS)**, and **uptime** are sampled each poll
from the OS (the mongosync process is located by its config file or PID) and plotted.

### Charts

Polled samples are persisted to SQLite and plotted over time:

- Copy progress (%) and bytes copied
- Copy throughput (bytes/sec)
- Change-event lag (seconds) and events applied
- Change events/sec
- CEA catch-up ETA (when available)
- Source vs destination ping latency (when available)
- Process CPU and memory

### Logs

The log panel toggles between two streams and refreshes every 5s with auto-scroll:

- **mongosync** — the structured JSON log from mongosync's `logPath`
  (`~/.mongosync-ui/logs/<id>/mongosync.log`). Levels are colour-coded.
- **process** — the wrapper's captured stdout/stderr
  (`~/.mongosync-ui/logs/<id>/stdout.log`), useful for startup/crash output.

Use the **Download** button to export the current view to a `.log` file.

### Other signals

The page also surfaces mongosync's `canCommit` / `canWrite`, `directionMapping` (current
source → destination, which updates after a reverse), ping latency, and any `warnings`.
