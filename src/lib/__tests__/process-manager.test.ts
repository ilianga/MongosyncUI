import { describe, it, expect } from "vitest";

async function load() {
  return await import("@/lib/process-manager");
}

describe("process-manager liveness", () => {
  it("isProcessAlive returns false for a non-existent PID", async () => {
    const { isProcessAlive } = await load();
    expect(isProcessAlive(99999999)).toBe(false);
  });

  it("isProcessAlive returns true for the current process", async () => {
    const { isProcessAlive } = await load();
    expect(isProcessAlive(process.pid)).toBe(true);
  });
});

import { describe as describe2, it as it2, expect as expect2, vi, beforeEach } from "vitest";

const sup = { superviseStart: vi.fn(), superviseStop: vi.fn() };
const tmuxMod = { hasTmux: vi.fn(() => true) };
vi.mock("@/lib/supervisor", () => sup);
vi.mock("@/lib/tmux", () => ({ ...tmuxMod, sessionName: (id: string) => `msync-${id}` }));
vi.mock("@/lib/supervision-config", () => ({ getSupervisionConfig: () => ({ mode: "supervised" }) }));

describe2("process-manager supervised routing", () => {
  beforeEach(() => { vi.resetModules(); sup.superviseStart.mockReset(); tmuxMod.hasTmux.mockReturnValue(true); });

  it2("spawnMongosync delegates to superviseStart when tmux is available", async () => {
    const { spawnMongosync } = await import("@/lib/process-manager");
    const migration = { id: "x", port: 27182 } as never;
    spawnMongosync(migration);
    expect2(sup.superviseStart).toHaveBeenCalledWith(migration);
  });
});
