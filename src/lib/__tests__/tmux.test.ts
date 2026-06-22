import { describe, it, expect, vi, beforeEach } from "vitest";

const spawnSync = vi.fn();
vi.mock("node:child_process", () => ({ spawnSync: (...a: unknown[]) => spawnSync(...a) }));

async function load() {
  vi.resetModules();
  return await import("@/lib/tmux");
}

beforeEach(() => spawnSync.mockReset());

describe("tmux wrapper", () => {
  it("derives a session name from a migration id", async () => {
    const { sessionName } = await load();
    expect(sessionName("abc123")).toBe("msync-abc123");
  });

  it("sessionExists reflects tmux has-session exit code", async () => {
    spawnSync.mockReturnValue({ status: 0 });
    const { sessionExists } = await load();
    expect(sessionExists("msync-x")).toBe(true);
    expect(spawnSync).toHaveBeenCalledWith("tmux", ["has-session", "-t", "msync-x"], expect.anything());

    spawnSync.mockReturnValue({ status: 1 });
    expect(sessionExists("msync-x")).toBe(false);
  });

  it("startSession launches a detached session running the command", async () => {
    spawnSync.mockReturnValue({ status: 0 });
    const { startSession } = await load();
    startSession("msync-x", "/path/wrapper.sh arg1");
    expect(spawnSync).toHaveBeenCalledWith(
      "tmux",
      ["new-session", "-d", "-s", "msync-x", "/path/wrapper.sh arg1"],
      expect.anything()
    );
  });

  it("listMsyncSessions returns only msync-* names", async () => {
    spawnSync.mockReturnValue({ status: 0, stdout: "msync-a\nmsync-b\nother\n" });
    const { listMsyncSessions } = await load();
    expect(listMsyncSessions()).toEqual(["msync-a", "msync-b"]);
  });

  it("hasTmux is false when tmux is not found", async () => {
    spawnSync.mockReturnValue({ status: null, error: new Error("ENOENT") });
    const { hasTmux } = await load();
    expect(hasTmux()).toBe(false);
  });
});
