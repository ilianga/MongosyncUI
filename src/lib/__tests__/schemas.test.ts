import { describe, it, expect } from "vitest";
import { migrationFormSchema, formValuesToConfig } from "@/lib/schemas";

const base = {
  name: "m",
  sourceUri: "mongodb://a",
  destUri: "mongodb://b",
  reversible: false,
  buildIndexes: "afterDataCopy" as const,
  detectRandomId: true,
  preExistingDestinationData: false,
  verificationEnabled: true,
  loadLevel: 3,
  verbosity: "INFO" as const,
  includeNamespaces: [],
  excludeNamespaces: [],
  shardingEntries: [],
};

describe("migrationFormSchema", () => {
  it("rejects a non-mongodb source URI", () => {
    const r = migrationFormSchema.safeParse({ ...base, sourceUri: "http://x" });
    expect(r.success).toBe(false);
  });
  it("accepts a valid minimal form", () => {
    expect(migrationFormSchema.safeParse(base).success).toBe(true);
  });
});

describe("formValuesToConfig", () => {
  it("only includes namespaces when non-empty and trims regex", () => {
    const cfg = formValuesToConfig({
      ...base,
      includeNamespaces: [{ database: "sales", collections: "EMEA, APAC", databaseRegex: "", collectionsRegex: "" }],
      excludeNamespaces: [{ database: "", collections: "", databaseRegex: "^tmp_", collectionsRegex: "" }],
    });
    expect(cfg.includeNamespaces).toEqual([{ database: "sales", collections: ["EMEA", "APAC"] }]);
    expect(cfg.excludeNamespaces).toEqual([{ databaseRegex: { pattern: "^tmp_" } }]);
  });

  it("omits loadLevel when at default 3 but keeps non-default", () => {
    expect(formValuesToConfig(base).loadLevel).toBeUndefined();
    expect(formValuesToConfig({ ...base, loadLevel: 4 }).loadLevel).toBe(4);
  });

  it("maps verification toggle to verificationEnabled", () => {
    expect(formValuesToConfig(base).verificationEnabled).toBe(true);
  });
});

describe("formValuesToConfig — shard-key parsing", () => {
  const withShard = (shardKey: string) =>
    formValuesToConfig({
      ...base,
      shardingEntries: [{ database: "mydb", collection: "mycol", shardKey }],
    });

  it("drops empty parts from blank or trailing-comma shard keys", () => {
    const cfg = withShard("field1:1,");
    const key = cfg.sharding!.shardingEntries[0].shardCollection.key;
    expect(key).toHaveLength(1);
    expect(key[0]).toEqual({ field1: 1 });
  });

  it("maps 'hashed' direction to the string 'hashed'", () => {
    const cfg = withShard("_id:hashed");
    const key = cfg.sharding!.shardingEntries[0].shardCollection.key;
    expect(key).toEqual([{ _id: "hashed" }]);
  });

  it("maps a plain field (no direction) to 1", () => {
    const cfg = withShard("region");
    const key = cfg.sharding!.shardingEntries[0].shardCollection.key;
    expect(key).toEqual([{ region: 1 }]);
  });

  it("maps '-1' direction to -1", () => {
    const cfg = withShard("ts:-1");
    const key = cfg.sharding!.shardingEntries[0].shardCollection.key;
    expect(key).toEqual([{ ts: -1 }]);
  });
});
