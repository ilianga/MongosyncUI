import { describe, it, expect, vi } from "vitest";

const execFileImpl = vi.fn();
vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => execFileImpl(...args),
}));

function mockMongosh(result: { stdout?: string; error?: Error }) {
  execFileImpl.mockImplementation((...args: unknown[]) => {
    const cb = args[args.length - 1] as (e: Error | null, out?: { stdout: string; stderr: string }) => void;
    if (typeof cb !== "function") return;
    if (result.error) cb(result.error);
    else cb(null, { stdout: result.stdout ?? "", stderr: "" });
  });
}

async function load() {
  return await import("@/lib/index-builds");
}

describe("getIndexBuilds", () => {
  it("parses builds and derives pct", async () => {
    mockMongosh({ stdout: JSON.stringify({ builds: [{ ns: "edreams.segments", done: 50, total: 200 }] }) });
    const { getIndexBuilds } = await load();
    expect(await getIndexBuilds("mongodb://u:p@h/admin")).toEqual([
      { ns: "edreams.segments", done: 50, total: 200, pct: 25 },
    ]);
  });

  it("returns pct null when total is 0 (non-scan phase)", async () => {
    mockMongosh({ stdout: JSON.stringify({ builds: [{ ns: "db.coll", done: 0, total: 0 }] }) });
    const { getIndexBuilds } = await load();
    expect((await getIndexBuilds("mongodb://u:p@h/admin"))?.[0].pct).toBeNull();
  });

  it("returns [] when nothing is building", async () => {
    mockMongosh({ stdout: JSON.stringify({ builds: [] }) });
    const { getIndexBuilds } = await load();
    expect(await getIndexBuilds("mongodb://u:p@h/admin")).toEqual([]);
  });

  it("returns null when the destination can't be queried", async () => {
    mockMongosh({ error: new Error("not authorized for $currentOp") });
    const { getIndexBuilds } = await load();
    expect(await getIndexBuilds("mongodb://u:p@h/admin")).toBeNull();
  });
});
