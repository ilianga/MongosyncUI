import { describe, it, expect, vi, beforeEach } from "vitest";

const execFileImpl = vi.fn();
vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => execFileImpl(...args),
}));

// Callback is always the LAST arg to execFile (mongosh.ts uses promisify(execFile)).
function mockMongosh(result: { stdout?: string; error?: Error }) {
  execFileImpl.mockImplementation((...args: unknown[]) => {
    const cb = args[args.length - 1] as (e: Error | null, out?: { stdout: string; stderr: string }) => void;
    if (typeof cb !== "function") return;
    if (result.error) cb(result.error);
    else cb(null, { stdout: result.stdout ?? "", stderr: "" });
  });
}

async function load() {
  return await import("@/lib/balancer");
}

beforeEach(() => {
  execFileImpl.mockReset();
});

describe("getBalancerState", () => {
  it("returns sharded + enabled from JSON", async () => {
    mockMongosh({ stdout: JSON.stringify({ sharded: true, enabled: true }) });
    const { getBalancerState } = await load();
    expect(await getBalancerState("mongodb://u:p@h/admin")).toEqual({ sharded: true, enabled: true });
  });

  it("reports sharded=false / enabled=null for a replica set", async () => {
    mockMongosh({ stdout: JSON.stringify({ sharded: false, enabled: null }) });
    const { getBalancerState } = await load();
    expect(await getBalancerState("mongodb://u:p@h/admin")).toEqual({ sharded: false, enabled: null });
  });

  it("coerces enabled=null when sharded but state unknown", async () => {
    mockMongosh({ stdout: JSON.stringify({ sharded: true, enabled: null }) });
    const { getBalancerState } = await load();
    expect(await getBalancerState("mongodb://u:p@h/admin")).toEqual({ sharded: true, enabled: null });
  });

  it("throws MongoshNotFoundError when mongosh is missing (ENOENT)", async () => {
    mockMongosh({ error: Object.assign(new Error("spawn mongosh ENOENT"), { code: "ENOENT" }) });
    const { getBalancerState, MongoshNotFoundError } = await import("@/lib/mongosh").then(async (m) => ({
      ...(await load()),
      MongoshNotFoundError: m.MongoshNotFoundError,
    }));
    await expect(getBalancerState("mongodb://u:p@h/admin")).rejects.toBeInstanceOf(MongoshNotFoundError);
  });

  it("throws on query failure (propagates, never silent)", async () => {
    mockMongosh({ error: new Error("not authorized on config") });
    const { getBalancerState } = await load();
    await expect(getBalancerState("mongodb://u:p@h/admin")).rejects.toThrow(/not authorized/);
  });

  it("throws on non-JSON output", async () => {
    mockMongosh({ stdout: "not json" });
    const { getBalancerState } = await load();
    await expect(getBalancerState("mongodb://u:p@h/admin")).rejects.toThrow(/non-JSON/);
  });
});

describe("stopBalancer / startBalancer", () => {
  it("stopBalancer resolves on success", async () => {
    mockMongosh({ stdout: "" });
    const { stopBalancer } = await load();
    await expect(stopBalancer("mongodb://u:p@h/admin")).resolves.toBeUndefined();
  });

  it("startBalancer resolves on success", async () => {
    mockMongosh({ stdout: "" });
    const { startBalancer } = await load();
    await expect(startBalancer("mongodb://u:p@h/admin")).resolves.toBeUndefined();
  });

  it("propagates MongoshNotFoundError from stopBalancer", async () => {
    mockMongosh({ error: Object.assign(new Error("spawn mongosh ENOENT"), { code: "ENOENT" }) });
    const m = await import("@/lib/mongosh");
    const { stopBalancer } = await load();
    await expect(stopBalancer("mongodb://u:p@h/admin")).rejects.toBeInstanceOf(m.MongoshNotFoundError);
  });

  it("propagates query failure from startBalancer", async () => {
    mockMongosh({ error: new Error("balancer command failed") });
    const { startBalancer } = await load();
    await expect(startBalancer("mongodb://u:p@h/admin")).rejects.toThrow(/balancer command failed/);
  });
});
