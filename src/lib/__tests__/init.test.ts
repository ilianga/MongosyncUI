import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "path";
import fs from "fs";
import os from "os";

const supervisor = { reconcile: vi.fn() };
const poller = { startPoller: vi.fn() };
const supervisionConfig = { getSupervisionConfig: vi.fn(() => ({ mode: "supervised" })) };
const tmux = { hasTmux: vi.fn(() => true) };
vi.mock("@/lib/supervisor", () => supervisor);
vi.mock("@/lib/poller", () => poller);
vi.mock("@/lib/supervision-config", () => supervisionConfig);
vi.mock("@/lib/tmux", () => tmux);
vi.mock("node:child_process", () => ({
  execFileSync: () => { throw new Error("no binary"); },
  spawnSync: () => ({ status: 1, stdout: "", stderr: "" })
}));

let dir: string, prev: string | undefined;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mongosync-ui-test-"));
  prev = process.env.MONGOSYNC_UI_DIR; process.env.MONGOSYNC_UI_DIR = dir;
  vi.resetModules(); supervisor.reconcile.mockReset(); poller.startPoller.mockReset();
});
afterEach(() => { process.env.MONGOSYNC_UI_DIR = prev; fs.rmSync(dir, { recursive: true, force: true }); });

describe("initApp", () => {
  it("reconciles supervised sessions and starts the poller", async () => {
    const { initApp } = await import("@/lib/init");
    initApp();
    expect(supervisor.reconcile).toHaveBeenCalled();
    expect(poller.startPoller).toHaveBeenCalled();
  });
});
