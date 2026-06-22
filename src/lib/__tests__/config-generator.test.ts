import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import * as yaml from "js-yaml";
import type { Migration, StartConfig } from "@/lib/types";

let testDir: string;
let originalEnv: string | undefined;

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), "mongosync-ui-test-"));
  originalEnv = process.env.MONGOSYNC_UI_DIR;
  process.env.MONGOSYNC_UI_DIR = testDir;
  vi.resetModules();
});

afterEach(() => {
  process.env.MONGOSYNC_UI_DIR = originalEnv;
  fs.rmSync(testDir, { recursive: true, force: true });
});

async function load() {
  return await import("@/lib/config-generator");
}

function migrationWith(config: StartConfig): Migration {
  return {
    id: "abc123",
    name: "test",
    sourceUri: "mongodb://src:27017",
    destUri: "mongodb://dst:27017",
    config: JSON.stringify(config),
    state: "IDLE",
    port: 27183,
    pid: null,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("generateConfig", () => {
  it("writes a YAML config with connection, port, and logPath", async () => {
    const { generateConfig } = await load();
    const p = generateConfig(migrationWith({ loadLevel: 4, verbosity: "DEBUG" }));
    expect(fs.existsSync(p)).toBe(true);
    const cfg = yaml.load(fs.readFileSync(p, "utf-8")) as Record<string, unknown>;
    expect(cfg.cluster0).toBe("mongodb://src:27017");
    expect(cfg.cluster1).toBe("mongodb://dst:27017");
    expect(cfg.port).toBe(27183);
    expect(cfg.logPath).toContain("abc123");
    expect(cfg.loadLevel).toBe(4);
    expect(cfg.verbosity).toBe("DEBUG");
  });

  it("omits process options that are not set", async () => {
    const { generateConfig } = await load();
    const p = generateConfig(migrationWith({}));
    const cfg = yaml.load(fs.readFileSync(p, "utf-8")) as Record<string, unknown>;
    expect(cfg).not.toHaveProperty("loadLevel");
    expect(cfg).not.toHaveProperty("createIndexesBatchSize");
    expect(cfg).not.toHaveProperty("id");
  });

  it("includes optional process flags when set", async () => {
    const { generateConfig } = await load();
    const p = generateConfig(
      migrationWith({
        createIndexesBatchSize: 16,
        id: "shard0",
        disableTelemetry: true,
        disableVerification: true,
        enableCappedCollectionHandling: true,
      })
    );
    const cfg = yaml.load(fs.readFileSync(p, "utf-8")) as Record<string, unknown>;
    expect(cfg.createIndexesBatchSize).toBe(16);
    expect(cfg.id).toBe("shard0");
    expect(cfg.disableTelemetry).toBe(true);
    expect(cfg.disableVerification).toBe(true);
    expect(cfg.enableCappedCollectionHandling).toBe(true);
  });
});

describe("buildStartBody", () => {
  it("always sets source and destination", async () => {
    const { buildStartBody } = await load();
    const body = buildStartBody(migrationWith({}));
    expect(body.source).toBe("cluster0");
    expect(body.destination).toBe("cluster1");
  });

  it("passes through start-time options with correct names", async () => {
    const { buildStartBody } = await load();
    const body = buildStartBody(
      migrationWith({
        reversible: true,
        buildIndexes: "afterDataCopy",
        detectRandomId: false,
        preExistingDestinationData: true,
        verificationEnabled: false,
      })
    );
    expect(body.reversible).toBe(true);
    expect(body.buildIndexes).toBe("afterDataCopy");
    expect(body.detectRandomId).toBe(false);
    expect(body.preExistingDestinationData).toBe(true);
    expect(body.verification).toEqual({ enabled: false });
  });

  it("maps namespace filters verbatim (database/collections/regex)", async () => {
    const { buildStartBody } = await load();
    const body = buildStartBody(
      migrationWith({
        includeNamespaces: [
          { database: "sales", collections: ["EMEA", "APAC"] },
          { databaseRegex: { pattern: "^analytics_", options: "i" } },
        ],
        excludeNamespaces: [{ database: "sales", collections: ["accounts_old"] }],
      })
    );
    expect(body.includeNamespaces).toEqual([
      { database: "sales", collections: ["EMEA", "APAC"] },
      { databaseRegex: { pattern: "^analytics_", options: "i" } },
    ]);
    expect(body.excludeNamespaces).toEqual([{ database: "sales", collections: ["accounts_old"] }]);
  });

  it("includes sharding config when present", async () => {
    const { buildStartBody } = await load();
    const body = buildStartBody(
      migrationWith({
        sharding: {
          createSupportingIndexes: true,
          shardingEntries: [
            { database: "db", collection: "c", shardCollection: { key: [{ userId: 1 }] } },
          ],
        },
      })
    );
    expect(body.sharding).toEqual({
      createSupportingIndexes: true,
      shardingEntries: [
        { database: "db", collection: "c", shardCollection: { key: [{ userId: 1 }] } },
      ],
    });
  });

  it("never emits an enableUserWriteBlocking field", async () => {
    const { buildStartBody } = await load();
    const body = buildStartBody(migrationWith({ reversible: true }));
    expect(body).not.toHaveProperty("enableUserWriteBlocking");
  });
});
