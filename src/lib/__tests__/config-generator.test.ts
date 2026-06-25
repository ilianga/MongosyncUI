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
    desiredRunning: 0,
    supervisionStatus: "stopped",
    restartCount: 0,
    lastExitCode: null,
    lastRestartAt: null,
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

describe("always-off telemetry / verification", () => {
  it("generateConfig always emits disableTelemetry: true even when config omits it", async () => {
    const { generateConfig } = await load();
    const p = generateConfig(migrationWith({}));
    const cfg = yaml.load(fs.readFileSync(p, "utf-8")) as Record<string, unknown>;
    expect(cfg.disableTelemetry).toBe(true);
  });

  it("buildStartBody always disables verification when config omits it", async () => {
    const { buildStartBody } = await load();
    const body = buildStartBody(migrationWith({}));
    expect(body.verification).toEqual({ enabled: false });
  });
});

describe("buildConfigPreview", () => {
  const baseInput = {
    sourceUri: "mongodb://user:secret@src:27017/",
    destUri: "mongodb://admin:hunter2@dst:27017/",
    config: { loadLevel: 4, verbosity: "DEBUG" } as StartConfig,
  };

  it("returns a YAML string and a startBody object without writing any file", async () => {
    const { buildConfigPreview } = await load();
    const dirBefore = fs.readdirSync(testDir);
    const { yaml: y, startBody } = buildConfigPreview(baseInput);
    expect(typeof y).toBe("string");
    expect(startBody.source).toBe("cluster0");
    expect(startBody.destination).toBe("cluster1");
    // No file written (preview is pure).
    expect(fs.readdirSync(testDir)).toEqual(dirBefore);
  });

  it("always sets telemetry off in the YAML and verification off in the start body", async () => {
    const { buildConfigPreview } = await load();
    const { yaml: y, startBody } = buildConfigPreview({ ...baseInput, config: {} });
    const cfg = yaml.load(y) as Record<string, unknown>;
    expect(cfg.disableTelemetry).toBe(true);
    expect(startBody.verification).toEqual({ enabled: false });
  });

  it("only enables verification when explicitly opted in (never by the UI)", async () => {
    const { buildConfigPreview } = await load();
    const optedIn = buildConfigPreview({ ...baseInput, config: { verificationEnabled: true } });
    expect(optedIn.startBody.verification).toEqual({ enabled: true });
  });

  it("uses an illustrative port when none is provided", async () => {
    const { buildConfigPreview } = await load();
    const cfg = yaml.load(buildConfigPreview(baseInput).yaml) as Record<string, unknown>;
    expect(cfg.port).toBe(27182);
  });

  it("the preview is maskable: passwords are removed when masked per-line (as the API does)", async () => {
    const { buildConfigPreview } = await load();
    const { maskUri } = await import("@/lib/format");
    const { yaml: y } = buildConfigPreview(baseInput);
    const masked = y.split("\n").map(maskUri).join("\n");
    expect(masked).not.toContain("secret");
    expect(masked).not.toContain("hunter2");
    expect(masked).toContain("user:***@src");
    expect(masked).toContain("admin:***@dst");
  });
});
