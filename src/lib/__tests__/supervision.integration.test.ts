import { describe, it, expect, beforeEach, afterEach } from "vitest";
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
