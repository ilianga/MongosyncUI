import { describe, it, expect, vi } from "vitest";
import type { Migration } from "@/lib/types";

// Mock execFile so resolvePid (pgrep) and getProcessStats (ps) are testable
// without spawning real processes. promisify(execFile) calls the trailing
// callback with (err, { stdout, stderr }). We key the implementation off the
// command name so the same mock answers both the pgrep and ps calls.
const execFileImpl = vi.fn();
vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => execFileImpl(...args),
}));

type Cb = (e: Error | null, out?: { stdout: string; stderr: string }) => void;

async function load() {
  return await import("@/lib/resource-stats");
}

const migration = (over: Partial<Migration> = {}): Migration =>
  ({
    id: "abc123",
    name: "m",
    sourceUri: "mongodb://a",
    destUri: "mongodb://b",
    config: "{}",
    state: "RUNNING",
    port: 27182,
    pid: 0,
    desiredRunning: 1,
    supervisionStatus: "running",
    restartCount: 0,
    lastExitCode: null,
    lastRestartAt: null,
    stopped: 0,
    plannedTotalBytes: null,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }) as Migration;

describe("getProcessStats", () => {
  it("parses a ps line and converts rss KB to bytes", async () => {
    execFileImpl.mockImplementation((cmd: string, _args: string[], _opts: unknown, cb: Cb) => {
      if (cmd === "pgrep") cb(null, { stdout: "4242\n", stderr: "" });
      else cb(null, { stdout: " 12.5  20480   3600 \n", stderr: "" });
    });
    const { getProcessStats } = await load();
    const stats = await getProcessStats(migration());
    expect(stats).toEqual({ cpuPercent: 12.5, rssBytes: 20480 * 1024, uptimeSec: 3600 });
  });

  it("falls back to migration.pid when pgrep finds nothing", async () => {
    execFileImpl.mockImplementation((cmd: string, args: string[], _opts: unknown, cb: Cb) => {
      if (cmd === "pgrep") cb(new Error("no match"));
      else {
        // assert we queried the fallback pid
        expect(args).toContain("9999");
        cb(null, { stdout: "1.0 1024 5\n", stderr: "" });
      }
    });
    const { getProcessStats } = await load();
    const stats = await getProcessStats(migration({ pid: 9999 }));
    expect(stats).toEqual({ cpuPercent: 1, rssBytes: 1024 * 1024, uptimeSec: 5 });
  });

  it("returns null when no pid can be resolved", async () => {
    execFileImpl.mockImplementation((cmd: string, _args: string[], _opts: unknown, cb: Cb) => {
      if (cmd === "pgrep") cb(new Error("no match"));
      else cb(null, { stdout: "", stderr: "" });
    });
    const { getProcessStats } = await load();
    const stats = await getProcessStats(migration({ pid: 0 }));
    expect(stats).toBeNull();
  });

  it("returns null when ps errors", async () => {
    execFileImpl.mockImplementation((cmd: string, _args: string[], _opts: unknown, cb: Cb) => {
      if (cmd === "pgrep") cb(null, { stdout: "100\n", stderr: "" });
      else cb(new Error("ps: no such process"));
    });
    const { getProcessStats } = await load();
    const stats = await getProcessStats(migration());
    expect(stats).toBeNull();
  });

  it("returns null on unparseable ps output", async () => {
    execFileImpl.mockImplementation((cmd: string, _args: string[], _opts: unknown, cb: Cb) => {
      if (cmd === "pgrep") cb(null, { stdout: "100\n", stderr: "" });
      else cb(null, { stdout: "garbage\n", stderr: "" });
    });
    const { getProcessStats } = await load();
    const stats = await getProcessStats(migration());
    expect(stats).toBeNull();
  });
});
