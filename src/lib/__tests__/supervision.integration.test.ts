import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { spawnSync } from "node:child_process";
import path from "path";
import fs from "fs";
import os from "os";

const SCRIPT = path.resolve(__dirname, "../../../scripts/mongosync-respawn.sh");
let dir: string;

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "wrap-")); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

// A "binary" that exits immediately with code 7 — forces the crash-loop path fast.
function crashingBin(): string {
  const p = path.join(dir, "crash.sh");
  fs.writeFileSync(p, "#!/usr/bin/env bash\nexit 7\n");
  fs.chmodSync(p, 0o755);
  return p;
}

describe("mongosync-respawn.sh", () => {
  it("stops at the crash-loop cap and records crash_looping with the last exit code", () => {
    const status = path.join(dir, "status.json");
    const stop = path.join(dir, "stop");
    // cap=3, window=300, backoffCap=0 so retries are immediate
    const res = spawnSync(
      "bash",
      [SCRIPT, crashingBin(), path.join(dir, "cfg.yaml"), dir, status, stop, "0", "3", "300"],
      { encoding: "utf-8", timeout: 15000 }
    );
    expect(res.status).toBe(0);
    const parsed = JSON.parse(fs.readFileSync(status, "utf-8").trim().split("\n").pop()!);
    expect(parsed.state).toBe("crash_looping");
    expect(parsed.lastExitCode).toBe(7);
    expect(parsed.attempt).toBeGreaterThanOrEqual(3);
  });

  it("exits cleanly without respawning when the stop sentinel exists at start", () => {
    const status = path.join(dir, "status.json");
    const stop = path.join(dir, "stop");
    fs.writeFileSync(stop, "");
    const res = spawnSync(
      "bash",
      [SCRIPT, crashingBin(), path.join(dir, "cfg.yaml"), dir, status, stop, "0", "3", "300"],
      { encoding: "utf-8", timeout: 5000 }
    );
    expect(res.status).toBe(0);
    expect(fs.existsSync(stop)).toBe(false); // sentinel consumed
  });
});

// ---------------------------------------------------------------------------
// E2E suite — requires real tmux. Auto-skips when tmux is absent.
// ---------------------------------------------------------------------------

const TMUX_OK = spawnSync("tmux", ["-V"]).status === 0;
const FAKE_BIN = path.resolve(__dirname, "fixtures/fake-mongosync.sh");

// Creates a tiny wrapper script that sets FAKE_MODE and delegates to fake-mongosync.sh.
// This avoids relying on tmux inheriting Node.js env vars (which is not guaranteed).
//
// For "crash" mode we use a minimal /bin/sh script that exits 7 directly, bypassing the
// bash→exec→bash chain used by fake-mongosync.sh.  On macOS/bash-3.2 the double-bash
// startup occasionally stalls for >10 s inside tmux sessions due to OS process
// scheduling, making the E2E poll window unreliable.  /bin/sh (POSIX sh / dash) starts
// much faster and has none of the bash-3.2 pipe/exec quirks.
function makeModeWrapper(tmpDir: string, mode: "crash" | "hang" | "normal"): string {
  const p = path.join(tmpDir, `fake-${mode}.sh`);
  if (mode === "crash") {
    // Minimal POSIX sh: no bash startup overhead, exits 7 immediately.
    fs.writeFileSync(p, "#!/bin/sh\nexit 7\n");
  } else {
    fs.writeFileSync(
      p,
      `#!/usr/bin/env bash\nexport FAKE_MODE=${mode}\nexec ${FAKE_BIN} "$@"\n`
    );
  }
  fs.chmodSync(p, 0o755);
  return p;
}

// Synchronous sleep using Atomics.wait (available in vitest worker threads).
// Avoids macOS process-scheduler throttling that can occur when Node.js enters an idle
// event-loop wait (setTimeout) — throttling can starve background tmux session processes
// for 10+ seconds even when the bash script just needs to run "exit 7".
function syncSleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Wait up to `maxMs` for `predicate()` to return true, polling every `intervalMs`.
// Synchronous: keeps the calling thread alive (no event-loop yielding) so the OS does
// not downgrade the QoS of the tmux session processes we are waiting on.
function pollUntil(
  predicate: () => boolean,
  maxMs: number,
  intervalMs = 200
): boolean {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    syncSleep(intervalMs);
  }
  return false;
}

const d = TMUX_OK ? describe : describe.skip;

d("supervision E2E (real tmux)", () => {
  let e2eDir: string;
  let origEnv: string | undefined;
  let sessionIds: string[] = [];

  beforeEach(() => {
    e2eDir = fs.mkdtempSync(path.join(os.tmpdir(), "msync-e2e-"));
    origEnv = process.env.MONGOSYNC_UI_DIR;
    process.env.MONGOSYNC_UI_DIR = e2eDir;
    sessionIds = [];
    vi.resetModules();
  });

  afterEach(() => {
    // Kill every session created by this test to keep the tmux server clean.
    for (const id of sessionIds) {
      spawnSync("tmux", ["kill-session", "-t", `msync-${id}`]);
    }
    // Belt-and-suspenders: kill any remaining msync-* sessions in the e2eDir namespace.
    const ls = spawnSync("tmux", ["list-sessions", "-F", "#{session_name}"], { encoding: "utf-8" });
    if (ls.status === 0) {
      for (const name of ls.stdout.split("\n").filter((s) => s.startsWith("msync-"))) {
        spawnSync("tmux", ["kill-session", "-t", name]);
      }
    }
    process.env.MONGOSYNC_UI_DIR = origEnv;
    fs.rmSync(e2eDir, { recursive: true, force: true });
    vi.resetModules();
  });

  it("respawns after a crash and records multiple attempts in the status file", async () => {
    // Arrange: fresh db + supervisor pointing at a crash-mode fake binary.
    // Use backoffCapSec=0 and crashLoopMax=3 so the wrapper respawns immediately
    // and we can observe attempt >= 2 within a few seconds without waiting for a
    // full crash-loop exhaustion (that's tested in the unit suite above).
    vi.resetModules();
    const db = await import("@/lib/db");
    const sup = await import("@/lib/supervisor");

    const crashWrapper = makeModeWrapper(e2eDir, "crash");

    // Configure supervision: zero backoff, cap at 3 so the wrapper exits quickly.
    db.setSetting("mongosyncPath", crashWrapper);
    db.setSetting("backoffCapSec", "0");
    db.setSetting("crashLoopMax", "3");
    db.setSetting("crashLoopWindowSec", "300");

    const m = db.createMigration({
      name: "e2e-crash",
      sourceUri: "mongodb://localhost:27017",
      destUri: "mongodb://localhost:27018",
      config: {},
      port: 27199,
    });
    sessionIds.push(m.id);

    // Act: start supervision (creates a real tmux session running the wrapper).
    sup.superviseStart(db.getMigration(m.id)!);

    // The session should exist immediately after superviseStart.
    const sessionCreated = spawnSync("tmux", ["has-session", "-t", `msync-${m.id}`]);
    expect(sessionCreated.status).toBe(0);

    // Poll: wait up to 10s for the status file to show attempt >= 2 with a recorded
    // exit code (lastExitCode !== null confirms the crash of attempt 2 was written,
    // avoiding a race where attempt=2 is seen before the binary has actually run).
    const statusFile = sup.statusPath(m.id);
    const reached = await pollUntil(() => {
      try {
        const raw = fs.readFileSync(statusFile, "utf-8").trim();
        if (!raw) return false;
        const last = raw.split("\n").pop()!;
        const parsed = JSON.parse(last);
        return parsed.attempt >= 2 && parsed.lastExitCode !== null;
      } catch {
        return false;
      }
    }, 10_000, 200);

    expect(reached).toBe(true);

    const status = sup.readWrapperStatus(m.id);
    expect(status).not.toBeNull();
    expect(status!.attempt).toBeGreaterThanOrEqual(2);
    // The wrapper is either still running (attempt < crashLoopMax) or already
    // finished crash_looping — either state is valid evidence of respawning.
    expect(["running", "crash_looping"]).toContain(status!.state);
    expect(status!.lastExitCode).toBe(7);
    // Explicit timeout: the internal pollUntil budget (10s) plus tmux/shell startup
    // exceeds vitest's 5s default, so the test must allow more wall-clock than the poll.
  }, 20_000);

  it("reconcile re-adopts an existing session after a server restart (identity by name, not PID)", async () => {
    // Arrange: use a hang-mode fake binary so the session stays alive.
    vi.resetModules();
    const db = await import("@/lib/db");
    const sup = await import("@/lib/supervisor");

    const hangWrapper = makeModeWrapper(e2eDir, "hang");
    db.setSetting("mongosyncPath", hangWrapper);

    const m = db.createMigration({
      name: "e2e-restart",
      sourceUri: "mongodb://localhost:27017",
      destUri: "mongodb://localhost:27018",
      config: {},
      port: 27198,
    });
    sessionIds.push(m.id);

    // Start — creates the real tmux session.
    sup.superviseStart(db.getMigration(m.id)!);

    // Wait until the session is actually up (bounded, since tmux session creation is async).
    const sessionUp = await pollUntil(
      () => spawnSync("tmux", ["has-session", "-t", `msync-${m.id}`]).status === 0,
      5_000,
      100
    );
    expect(sessionUp).toBe(true);
    expect(db.getMigration(m.id)!.desiredRunning).toBe(1);

    // Capture session identity BEFORE the simulated restart.
    // We use `session_created` (a Unix timestamp tmux records when it created the
    // session) as an immutable identity marker — re-adoption must leave it unchanged.
    // As a secondary check we also capture the pane PID.
    const sessionName = `msync-${m.id}`;

    const createdBefore = spawnSync(
      "tmux",
      ["list-sessions", "-F", "#{session_name} #{session_created}"],
      { encoding: "utf-8" }
    ).stdout
      .split("\n")
      .find((l) => l.startsWith(sessionName + " "))
      ?.split(" ")[1];
    expect(createdBefore).toBeTruthy(); // guard: session must be listed

    const panePidBefore = spawnSync(
      "tmux",
      ["list-panes", "-t", sessionName, "-F", "#{pane_pid}"],
      { encoding: "utf-8" }
    ).stdout.trim();
    expect(panePidBefore).toBeTruthy();

    // Count sessions for this id before reconcile (must be exactly 1).
    const countSessions = (): number =>
      spawnSync("tmux", ["list-sessions", "-F", "#{session_name}"], { encoding: "utf-8" })
        .stdout.split("\n")
        .filter((s) => s === sessionName).length;
    expect(countSessions()).toBe(1);

    // Simulate server restart: reset module cache so supervisor re-imports with no
    // in-memory state (mirrors what happens when the Next.js server process restarts).
    vi.resetModules();
    const db2 = await import("@/lib/db");
    const sup2 = await import("@/lib/supervisor");

    // The session already exists in tmux; desiredRunning=1 persists in SQLite.
    // reconcile() must NOT kill and re-create the session — it must re-adopt by name.
    sup2.reconcile();

    // --- Primary assertions: real tmux state, not a spy ---

    // 1. Session still exists after reconcile.
    expect(spawnSync("tmux", ["has-session", "-t", sessionName]).status).toBe(0);

    // 2. Exactly ONE session for this id — no duplicate was created.
    expect(countSessions()).toBe(1);

    // 3. session_created is UNCHANGED — proves the original session was re-adopted,
    //    not killed and replaced with a new one.
    const createdAfter = spawnSync(
      "tmux",
      ["list-sessions", "-F", "#{session_name} #{session_created}"],
      { encoding: "utf-8" }
    ).stdout
      .split("\n")
      .find((l) => l.startsWith(sessionName + " "))
      ?.split(" ")[1];
    expect(createdAfter).toBe(createdBefore);

    // 4. Pane PID is UNCHANGED — the same process is running inside the session.
    const panePidAfter = spawnSync(
      "tmux",
      ["list-panes", "-t", sessionName, "-F", "#{pane_pid}"],
      { encoding: "utf-8" }
    ).stdout.trim();
    expect(panePidAfter).toBe(panePidBefore);

    // 5. DB row reflects running state (not "restarting" — that would mean reconcile
    //    thought the session was missing and restarted it from scratch).
    const after = db2.getMigration(m.id)!;
    expect(after.supervisionStatus).toBe("running");
    // Explicit timeout: bounded waits + many tmux spawnSync calls can approach the
    // 5s default on a loaded machine; give headroom so this can't time out spuriously.
  }, 15_000);

  // Hung-session detection is intentionally skipped here.
  //
  // Rationale: the hung detector is driven by pollOnce() calling a live HTTP
  // endpoint; "hung" means no response for `hungTicks` consecutive poll cycles.
  // In a unit-test timeframe this requires either (a) waiting for multiple real
  // network timeouts or (b) injecting a custom poll loop with a very small tick
  // interval — both paths introduce unacceptable flakiness or make the test
  // structurally equivalent to a unit test (in which case there is nothing
  // genuinely E2E about it).  The hung-detector logic is covered by unit tests
  // in health-monitor.test.ts.  A proper E2E hung test would belong in a
  // dedicated slow-integration suite with a multi-second allowed runtime.
  it.skip("detects a hung session and marks it accordingly (skipped — requires multi-second poll loop, flaky in CI)", () => {
    // See comment above.
  });
});
