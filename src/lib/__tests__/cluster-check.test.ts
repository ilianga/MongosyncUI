import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock execFile so the mongosh-backed helpers are testable without a live cluster.
// promisify(execFile) calls the trailing callback with (err, { stdout, stderr }).
const execFileImpl = vi.fn();
vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => execFileImpl(...args),
}));

// Mock DNS SRV resolution so the mongodb+srv reachability path is testable offline.
const resolveSrvImpl = vi.fn();
vi.mock("node:dns", () => ({
  promises: { resolveSrv: (...args: unknown[]) => resolveSrvImpl(...args) },
}));

function mockMongosh(result: { stdout?: string; error?: Error }) {
  execFileImpl.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: (e: Error | null, out?: { stdout: string; stderr: string }) => void) => {
    if (result.error) cb(result.error);
    else cb(null, { stdout: result.stdout ?? "", stderr: "" });
  });
}

async function load() {
  return await import("@/lib/cluster-check");
}

beforeEach(() => {
  execFileImpl.mockReset();
  resolveSrvImpl.mockReset();
});

describe("parseMongoUri", () => {
  it("extracts a single host:port", async () => {
    const { parseMongoUri } = await load();
    expect(parseMongoUri("mongodb://user:pass@host1:27017/db").hosts).toEqual(["host1:27017"]);
  });

  it("flags mongodb+srv URIs as srv (and plain mongodb as not)", async () => {
    const { parseMongoUri } = await load();
    expect(parseMongoUri("mongodb+srv://u:p@cluster.mongodb.net/db").srv).toBe(true);
    expect(parseMongoUri("mongodb://h:27017/db").srv).toBe(false);
  });

  it("extracts multiple hosts from a replica set URI", async () => {
    const { parseMongoUri } = await load();
    expect(parseMongoUri("mongodb://h1:27017,h2:27018,h3:27019/?replicaSet=rs0").hosts).toEqual([
      "h1:27017",
      "h2:27018",
      "h3:27019",
    ]);
  });

  it("defaults port 27017 when omitted", async () => {
    const { parseMongoUri } = await load();
    expect(parseMongoUri("mongodb://localhost/test").hosts).toEqual(["localhost:27017"]);
  });

  it("handles mongodb+srv by returning the srv host", async () => {
    const { parseMongoUri } = await load();
    expect(parseMongoUri("mongodb+srv://user:pass@cluster.mongodb.net/db").hosts).toEqual([
      "cluster.mongodb.net:27017",
    ]);
  });
});

describe("probeReachable (mongodb+srv)", () => {
  it("is reachable when the SRV record resolves (no raw TCP to the SRV domain)", async () => {
    resolveSrvImpl.mockResolvedValue([{ name: "shard-00.x.mongodb.net", port: 27017 }]);
    const { probeReachable } = await load();
    const r = await probeReachable("mongodb+srv://u:p@cluster.mongodb.net/");
    expect(r.reachable).toBe(true);
    // Must resolve the SRV name, not TCP-connect to the bare SRV domain.
    expect(resolveSrvImpl).toHaveBeenCalledWith("_mongodb._tcp.cluster.mongodb.net");
  });

  it("is unreachable with a clear error when the SRV record does not resolve", async () => {
    resolveSrvImpl.mockRejectedValue(Object.assign(new Error("queryA ENOTFOUND"), { code: "ENOTFOUND" }));
    const { probeReachable } = await load();
    const r = await probeReachable("mongodb+srv://u:p@nope.mongodb.net/");
    expect(r.reachable).toBe(false);
    expect(r.error).toMatch(/SRV/i);
  });
});

describe("hasSyncState", () => {
  it("returns true when the destination has the mongosync state DB", async () => {
    mockMongosh({ stdout: '{ "has": true }\n' });
    const { hasSyncState } = await load();
    expect(await hasSyncState("mongodb://u:p@h:27017/admin")).toBe(true);
  });

  it("returns false when the state DB is absent", async () => {
    mockMongosh({ stdout: '{ "has": false }' });
    const { hasSyncState } = await load();
    expect(await hasSyncState("mongodb://u:p@h:27017/admin")).toBe(false);
  });

  it("throws when mongosh fails, so callers can fall back", async () => {
    mockMongosh({ error: new Error("mongosh not found") });
    const { hasSyncState } = await load();
    await expect(hasSyncState("mongodb://h/admin")).rejects.toThrow();
  });
});

describe("dropSyncState", () => {
  it("invokes mongosh with a dropDatabase eval for the state DB", async () => {
    mockMongosh({ stdout: "" });
    const { dropSyncState, MONGOSYNC_STATE_DB } = await load();
    await dropSyncState("mongodb://u:p@h:27017/admin");
    const evalArg = (execFileImpl.mock.calls[0][1] as string[]).at(-1) as string;
    expect(evalArg).toContain("dropDatabase");
    expect(evalArg).toContain(MONGOSYNC_STATE_DB);
  });
});

describe("hasSyncState error paths", () => {
  it("surfaces a clear error when mongosh is missing (ENOENT)", async () => {
    execFileImpl.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: (e: Error | null) => void) => {
        cb(Object.assign(new Error("spawn mongosh ENOENT"), { code: "ENOENT" }));
      }
    );
    const { hasSyncState } = await load();
    await expect(hasSyncState("mongodb://h/admin")).rejects.toThrow(/not installed|not on PATH/);
  });

  it("throws on non-JSON output so callers can fall back", async () => {
    mockMongosh({ stdout: "garbage not json" });
    const { hasSyncState } = await load();
    await expect(hasSyncState("mongodb://h/admin")).rejects.toThrow(/non-JSON/);
  });
});
