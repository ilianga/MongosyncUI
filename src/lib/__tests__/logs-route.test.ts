import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

// The logs route reads getMigration from @/lib/db; stub it so we don't need a real SQLite
// database. The migration just needs to exist (truthy) for the 404 guard to pass.
vi.mock("@/lib/db", () => ({
  getMigration: (id: string) => (id === "mig1" ? { id } : null),
}));

let testDir: string;
let originalEnv: string | undefined;

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), "mongosync-ui-logs-"));
  originalEnv = process.env.MONGOSYNC_UI_DIR;
  process.env.MONGOSYNC_UI_DIR = testDir;
  vi.resetModules();
});

afterEach(() => {
  process.env.MONGOSYNC_UI_DIR = originalEnv;
  fs.rmSync(testDir, { recursive: true, force: true });
});

async function loadRoute() {
  // Re-import after resetModules so paths picks up the per-test MONGOSYNC_UI_DIR.
  vi.doMock("@/lib/db", () => ({
    getMigration: (id: string) => (id === "mig1" ? { id } : null),
  }));
  return import("@/app/api/migrations/[id]/logs/route");
}

function req(qs: string): Request {
  return new Request(`http://localhost/api/migrations/mig1/logs${qs}`);
}

const ctx = { params: Promise.resolve({ id: "mig1" }) };

describe("logs route — shard param", () => {
  it("reads from the migration root when shard is absent", async () => {
    const { getLogDir } = await import("@/lib/paths");
    fs.writeFileSync(path.join(getLogDir("mig1"), "mongosync.log"), "root-a\nroot-b\n");

    const { GET } = await loadRoute();
    const res = await GET(req("?lines=300"), ctx);
    expect(await res.json()).toEqual({ lines: ["root-a", "root-b"] });
  });

  it("reads from the instance subdir when shard is present", async () => {
    const { getInstanceLogDir } = await import("@/lib/paths");
    fs.writeFileSync(path.join(getInstanceLogDir("mig1", "shardA"), "mongosync.log"), "shard-a\n");

    const { GET } = await loadRoute();
    const res = await GET(req("?shard=shardA"), ctx);
    expect(await res.json()).toEqual({ lines: ["shard-a"] });
  });

  it("returns empty lines when the shard log file does not exist", async () => {
    const { GET } = await loadRoute();
    const res = await GET(req("?shard=missing"), ctx);
    expect(await res.json()).toEqual({ lines: [] });
  });

  it("404s for an unknown migration", async () => {
    const { GET } = await loadRoute();
    const res = await GET(
      new Request("http://localhost/api/migrations/nope/logs"),
      { params: Promise.resolve({ id: "nope" }) }
    );
    expect(res.status).toBe(404);
  });
});
