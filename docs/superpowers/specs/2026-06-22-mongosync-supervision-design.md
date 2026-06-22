# Mongosync Instance Supervision & Fault Tolerance — Design

**Date:** 2026-06-22
**Status:** Approved (design); pending implementation plan

## Problem

mongosync instances are currently launched as bare detached child processes of the
Next.js server, tracked by a raw PID stored in SQLite. This is fragile:

- **No auto-restart on crash** — when a process exits, the poller just nulls the PID and
  the migration silently stalls.
- **PID-reuse risk** — after a reboot a recycled PID can falsely read as "alive" via
  `process.kill(pid, 0)`, so the app can attach to or trust the wrong process.
- **No detection of hung-but-alive processes** — liveness-by-PID can't tell that
  `/progress` has stopped responding.
- **No supervision while the server is down** — CLAUDE.md's "no daemon" stance means
  nothing keeps instances healthy when Next.js isn't running.

We want elevated fault tolerance across four failure modes: **process crash**,
**hung/unresponsive**, **server restart**, and **machine reboot**.

## Explicit Trade-off

This design deliberately departs from two CLAUDE.md principles — **"No daemon"** and
**"Simplicity first"** — to gain robustness. The departure is intentional and layered:
the cross-platform core (tmux + wrapper + monitor) adds no always-on daemon of our own,
and the only OS-level piece (boot service) is optional and isolated. CLAUDE.md should be
updated to reflect the new supervision model once implemented.

## Chosen Approach

**Approach A — Layered supervision:** tmux session per migration running a respawn
wrapper, an upgraded in-app health monitor, and one optional OS unit for reboot.

Considered and rejected:
- **Per-migration OS units** (dynamically generated systemd/launchd): heavy
  cross-platform branching, fiddly dynamic unit lifecycle, weak live observability.
- **Dedicated Node supervisor daemon:** reinvents supervision that tmux/systemd already
  do well, needs its own OS unit anyway, adds app↔daemon IPC, loses tmux observability.

Target environment: **Linux server or both Linux and macOS.** This rules out a
launchd-only solution and favors a cross-platform core.

## Architecture

Three layers. The crucial split: **the wrapper keeps the OS *process* alive; the app
drives the mongosync *API state*.** Responsibilities never overlap.

```
┌─ OS unit (optional) ──────────────────────────────────────┐
│  systemd user service (Linux) / launchd agent (macOS)      │
│  • starts the Next.js app at boot                          │
│  • only platform-specific piece; isolated & optional       │
└────────────────────────────────────────────────────────────┘
            │ starts
            ▼
┌─ Next.js app — Health Monitor (upgraded poller) ──────────┐
│  • reconciles desired-vs-actual on startup & every tick    │
│  • detects HUNG (API unreachable while process alive)      │
│  • drives API state: re-issues /start so a respawned       │
│    binary RESUMES from destination-persisted state         │
│  • identity = tmux session name + /progress handshake      │
└────────────────────────────────────────────────────────────┘
            │ creates / kills
            ▼
┌─ tmux session  "msync-<id>"  (one per migration) ─────────┐
│  runs a RESPAWN WRAPPER:                                    │
│    while not <stop sentinel>:                               │
│        mongosync --config <file>   # crash → relaunch       │
│        backoff (2s→60s), write attempt/exit to status file  │
│        crash-loop cap → stop & mark crash-looping           │
│  • crash self-heals locally, independent of the app         │
│  • durable across app restarts; `tmux attach` to watch live │
└────────────────────────────────────────────────────────────┘
```

### Failure-mode coverage

| Failure | Handled by |
|---|---|
| **Process crash** | Wrapper relaunches the binary locally → monitor re-drives `/start` to resume. No daemon needed. |
| **Hung / unresponsive** | Monitor sees process alive but `/progress` unreachable for N ticks → kills the pane → wrapper respawns. Merely *slow* progress = warning only, never auto-killed. |
| **Server restart** | tmux sessions outlive the app; on restart the monitor re-adopts them by **session name + handshake**, not PID. |
| **Machine reboot** | OS unit restarts the app at boot; app recreates tmux sessions for migrations marked "should be running." tmux dies on reboot, so the app is the single reconciliation path. |

## Components

### New files

- **`src/lib/tmux.ts`** — thin wrapper around the `tmux` CLI. `hasTmux()`,
  `sessionName(id)` → `msync-<id>`, `sessionExists(name)`, `startSession(name, cmd)`,
  `killSession(name)`, `listMsyncSessions()`. Pure shell-out, no business logic;
  easily mocked.
- **`scripts/mongosync-respawn.sh`** — the respawn wrapper. Args: config path, log dir,
  status-file path, backoff/cap params. Runs mongosync in a loop, honors a `stop`
  sentinel, writes a one-line JSON **status file**
  (`{attempt, lastExitCode, lastStartAt, state}`) after each spawn/exit.
- **`src/lib/supervisor.ts`** — orchestration brain. `superviseStart(migration)`,
  `superviseStop(migration, {respawn:false})`, `reconcile()` (desired-vs-actual; called
  on startup + each tick), `readStatus(id)`.
- **`src/lib/os-unit.ts`** — generates + installs/uninstalls the systemd user unit
  (Linux) and launchd plist (macOS). Branch on `process.platform`. Invoked from a
  Settings action or a CLI command.

### Changed files

- **`process-manager.ts`** — `spawnMongosync`/`killMongosync` reroute through
  `supervisor.ts`/`tmux.ts` instead of bare detached `spawn`. Keep `sendCommand`,
  `fetchProgress`, `resolveMongosyncBin` as-is. Add tmux-absent fallback.
- **`poller.ts`** → **health monitor**: still polls `/progress`, but also calls
  `supervisor.reconcile()`, applies hung-detection, reads wrapper status files.
- **`init.ts`** — startup reconciliation recreates tmux sessions for `desired_running`
  migrations instead of just nulling dead PIDs.
- **`db.ts`** / **`types.ts`** — schema additions below.

### DB schema additions (`migrations` table)

| Column | Purpose |
|---|---|
| `desired_running` | Intent flag. `true` on start; `false` on user pause/commit/delete. The reconciliation target. |
| `supervision_status` | `running` \| `restarting` \| `crash_looping` \| `stopped` \| `unsupervised`. Drives a UI badge. |
| `restart_count` | Restarts within the current window (from wrapper status file). |
| `last_exit_code` / `last_restart_at` | Diagnostics + crash-loop detection. |

`pid` becomes informational only. **Identity is the deterministic session name**
`msync-<id>` + a `/progress` handshake (match `mongosyncID`/port) on re-adoption,
eliminating PID-reuse risk.

## Health Monitoring & Restart Policy

Guiding rule: **auto-restart only on unambiguous failure; everything fuzzy is a warning,
not an action.** Killing a healthy-but-slow migration is worse than leaving it alone.

### Loop 1 — wrapper (OS process liveness, no API awareness)

- mongosync exits → wait `backoff` (2s → 4s → … cap 60s) → relaunch → increment
  `attempt` in status file.
- **Crash-loop cap:** ≥ `N` exits (default 5) within window `W` (default 5 min) →
  stop looping, write `state: crash_looping`, exit.
- Honors a `stop` sentinel file → clean exit, no respawn (intentional stop).

### Loop 2 — monitor (API state, every tick)

| Condition observed | Classification | Action |
|---|---|---|
| Session exists, `/progress` OK, state advancing | **healthy** | record metrics, `supervision_status=running` |
| Session exists, binary up, `/progress` **unreachable** ≥ `H` ticks (default 6 ≈ 30s) | **hung** | kill pane → wrapper respawns → re-drive `/start` |
| Session up, `/progress` OK & `RUNNING`, but lag frozen / no events for a long window | **stalled** | ⚠️ surface warning only — never auto-kill |
| Wrapper status = `crash_looping` | **crash-looping** | stop supervising, mark prominently, require manual intervention |
| `desired_running=true` but **no session** | **missing** | recreate session (reboot / external kill) |
| Respawned binary up `IDLE`/`INITIALIZING` with resumable state | **needs-resume** | monitor re-issues `/start` → resumes from destination state |
| `desired_running=false` | **stopped** | ensure no session; ignore |

### Intentional-stop vs crash (the linchpin)

Every user action (pause/commit/delete) first sets `desired_running=false` **and** drops
the `stop` sentinel *before* killing the session. The wrapper never respawns an
intentional stop; the monitor never "rescues" it. Crash = session/process gone while
`desired_running` is still `true`.

### Reconciliation

`supervisor.reconcile()` (startup + each tick): for every migration, compare
`desired_running` against actual session presence + health, and nudge toward desired.
Idempotent — which is exactly why reboot recovery, server-restart re-adoption, and
missing-session recovery all fall out of the *same* code path.

All thresholds (`backoff cap`, `N`, `W`, `H`, stalled window) are **settings** with
sane defaults.

## Reboot Survival & OS Unit

Principle: **get the app running at boot, and let `reconcile()` do the rest.** tmux
sessions don't survive a reboot, so the app rebuilds them from `desired_running` via the
same reconciliation path used everywhere else. One path, three triggers (reboot,
server-restart, missing-session).

### Installed artifacts (opt-in, generated by `os-unit.ts`)

- **Linux — systemd user service** `~/.config/systemd/user/mongosync-ui.service`:
  `ExecStart` = app server, `Restart=on-failure`, `WantedBy=default.target`. Requires
  `loginctl enable-linger <user>` so it starts at boot without interactive login; the
  installer runs this and reports if sudo is needed.
- **macOS — launchd LaunchAgent** `~/Library/LaunchAgents/com.mongosyncui.app.plist`:
  `RunAtLoad=true`, `KeepAlive=true` (also restarts the app on app-crash).

### Boot sequence

1. OS starts the app.
2. `initApp()` → `reconcile()`: for each migration with `desired_running=true`, recreate
   `msync-<id>` running the wrapper.
3. Each binary comes up, reads destination-persisted state; monitor sees
   `IDLE`/`INITIALIZING` → re-issues `/start` → resumes.

### UX

Settings → **Supervision** panel with Install/Uninstall boot-service toggle showing
status (installed? lingering enabled? app reachable?). Equivalent
`npm run supervisor:install` / `:uninstall` CLI commands for headless setups. README
gains a "Reliable / always-on operation" section.

### Scope note

This is the only platform-specific layer and the only piece that touches OS config.
Without it you still get crash + hung + server-restart resilience; you'd just start the
app yourself after a reboot. Genuinely optional, cleanly separated.

## Error Handling & Edge Cases

- **tmux not installed** — detected via `hasTmux()` at startup and before any supervised
  start. A `supervisionMode` setting: `supervised` (default, needs tmux) or `legacy`
  (today's detached `spawn`). If tmux is missing while `supervised`: fall back to legacy
  spawn for that start, set `supervision_status=unsupervised`, show a persistent banner
  ("tmux not found — running without fault tolerance"). Graceful degradation, never a
  hard block.
- **mongosync resume semantics** — *verify before implementing*: exactly how a relaunched
  binary re-enters an in-progress migration (does `/start` resume, or a distinct path?).
  Risk is isolated to the monitor's `needs-resume` transition; if the mechanic differs,
  only that function changes.
- **Double-spawn** — `startSession` checks `sessionExists` first; deterministic name
  prevents two sessions for one migration.
- **App killed mid-action** — every change is "set DB intent → act on tmux"; `reconcile()`
  is idempotent, so half-finished actions self-heal next tick.
- **Stale session after delete** — delete sets `desired_running=false` + sentinel, kills
  the session, then reconcile sweeps orphan `msync-*` sessions with no matching DB row.
- **Port already in use on respawn** — treated like a failed start → backoff + retry;
  surfaced if it hits the crash-loop cap.
- **Crash-loop terminal state** — not silently abandoned: `supervision_status=crash_looping`,
  prominent UI alert with last exit code + wrapper log tail, manual **Retry** that resets
  the counter and re-supervises.
- **Stop/kill ordering** — always: set `desired_running=false` → write `stop` sentinel →
  `tmux kill-session`. If the app dies between steps, reconcile reads `desired_running=false`
  and finishes teardown.

## Testing Strategy

Fits the existing Vitest + mockable `src/lib` pattern. Key enabler: a **fake mongosync
binary** for fault injection.

**Fake-mongosync harness** — a small bash/node stub serving minimal `/api/v1/progress`
and `/start`, controllable (env/flags) to: run normally, exit with a code after N seconds
(crash), stop responding to HTTP while staying alive (hung), or come up
`IDLE`-with-resumable-state. Drives every failure mode end-to-end under a real tmux
session.

**Unit tests (mocked tmux + fs):**
- `tmux.ts` — session-name derivation, command construction, `list-sessions` parsing.
- `supervisor.ts` — `reconcile()` truth table over every
  (`desired_running` × session-present × health); idempotency.
- Restart policy — backoff progression, crash-loop cap trips at `N`/`W`, counter reset on
  manual retry.
- Hung-detection state machine — `H`-consecutive-unreachable triggers restart; *stalled*
  (slow but reachable) produces a **warning, never a kill** (regression test protecting
  the "warn-don't-kill" rule).
- Status-file parsing; intentional-stop ordering (sentinel before kill).
- `os-unit.ts` — generated systemd unit / launchd plist content per platform (snapshot
  tests).

**Integration tests (real tmux + fake binary):** spawn via supervisor, then inject
crash → assert respawn + state resume; inject hung → assert pane-kill + respawn; simulate
server restart (drop monitor, re-run `reconcile()`) → assert re-adoption by session name +
handshake, not PID. Auto-skipped when tmux isn't on `PATH` so tmux-less CI still passes.

## Out of Scope

- Multi-host / distributed supervision (single host only).
- Supervising the multi-instance *sharded* sync orchestration beyond what a per-migration
  session already provides (future work if needed).
- Replacing SQLite as the source of truth.
