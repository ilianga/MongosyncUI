import { getAllMigrations, updateMigration, getSetting, setSetting } from "./db";
import { isProcessAlive } from "./process-manager";
import { startPoller } from "./poller";
import { execFileSync } from "node:child_process";

let initialized = false;

function detectBinary(): void {
  if (getSetting("mongosyncPath")) return;
  const candidates = ["mongosync", "/usr/local/bin/mongosync", "/opt/homebrew/bin/mongosync", "/usr/bin/mongosync"];
  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ["--version"], { timeout: 3000, stdio: "ignore" });
      setSetting("mongosyncPath", candidate);
      return;
    } catch {
      // try next
    }
  }
}

export function initApp(): void {
  if (initialized) return;
  initialized = true;

  // Reconcile processes that died while the server was down.
  for (const m of getAllMigrations()) {
    if (m.pid && !isProcessAlive(m.pid)) updateMigration(m.id, { pid: null });
  }

  detectBinary();
  startPoller(Number(getSetting("pollInterval") || "5000"));
}
