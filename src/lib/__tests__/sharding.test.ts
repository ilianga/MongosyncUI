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
  return await import("@/lib/sharding");
}

describe("listSourceShards", () => {
  it("returns shard ids for a sharded cluster", async () => {
    mockMongosh({ stdout: JSON.stringify({ ok: 1, shards: [{ _id: "shard0" }, { _id: "shard1" }] }) });
    const { listSourceShards } = await load();
    expect(await listSourceShards("mongodb://u:p@mongos/admin")).toEqual(["shard0", "shard1"]);
  });

  it("returns null for a replica set (ok:0)", async () => {
    mockMongosh({ stdout: JSON.stringify({ ok: 0 }) });
    const { listSourceShards } = await load();
    expect(await listSourceShards("mongodb://u:p@rs/admin")).toBeNull();
  });

  it("returns null when no shards are present", async () => {
    mockMongosh({ stdout: JSON.stringify({ ok: 1, shards: [] }) });
    const { listSourceShards } = await load();
    expect(await listSourceShards("mongodb://u:p@h/admin")).toBeNull();
  });

  it("returns null when mongosh is missing (ENOENT)", async () => {
    mockMongosh({ error: Object.assign(new Error("spawn mongosh ENOENT"), { code: "ENOENT" }) });
    const { listSourceShards } = await load();
    expect(await listSourceShards("mongodb://u:p@h/admin")).toBeNull();
  });

  it("returns null on non-JSON output", async () => {
    mockMongosh({ stdout: "not json" });
    const { listSourceShards } = await load();
    expect(await listSourceShards("mongodb://u:p@h/admin")).toBeNull();
  });

  it("filters out blank shard ids", async () => {
    mockMongosh({ stdout: JSON.stringify({ ok: 1, shards: [{ _id: "shardA" }, { _id: "" }, {}] }) });
    const { listSourceShards } = await load();
    expect(await listSourceShards("mongodb://u:p@h/admin")).toEqual(["shardA"]);
  });
});

describe("assignInstancePorts", () => {
  it("assigns sequential ports from basePort", async () => {
    const { assignInstancePorts } = await load();
    expect(assignInstancePorts(["s0", "s1", "s2"], 27182, [])).toEqual([
      { shardId: "s0", port: 27182 },
      { shardId: "s1", port: 27183 },
      { shardId: "s2", port: 27184 },
    ]);
  });

  it("skips already-used ports", async () => {
    const { assignInstancePorts } = await load();
    expect(assignInstancePorts(["s0", "s1"], 27182, [27182, 27183])).toEqual([
      { shardId: "s0", port: 27184 },
      { shardId: "s1", port: 27185 },
    ]);
  });

  it("never reuses a port within one assignment", async () => {
    const { assignInstancePorts } = await load();
    const ports = assignInstancePorts(["a", "b", "c", "d"], 100, [101, 103]).map((x) => x.port);
    expect(new Set(ports).size).toBe(4);
    expect(ports).toEqual([100, 102, 104, 105]);
  });

  it("returns [] for no shards", async () => {
    const { assignInstancePorts } = await load();
    expect(assignInstancePorts([], 27182, [])).toEqual([]);
  });
});
