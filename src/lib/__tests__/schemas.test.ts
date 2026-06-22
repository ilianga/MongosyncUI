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
