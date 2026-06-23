import { describe, it, expect } from "vitest";
import { migrationFormSchema, formValuesToConfig, connToConfig } from "@/lib/schemas";

const base = {
  name: "m",
  source: { raw: "mongodb://a" },
  dest: { raw: "mongodb://b" },
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
  it("rejects a structured connection with no host and no raw string", () => {
    const r = migrationFormSchema.safeParse({ ...base, source: { authMethod: "none" } });
    expect(r.success).toBe(false);
  });
  it("accepts a valid minimal form with raw connection strings", () => {
    expect(migrationFormSchema.safeParse(base).success).toBe(true);
  });
  it("accepts a structured connection with hosts", () => {
    const r = migrationFormSchema.safeParse({
      ...base,
      source: { scheme: "mongodb", hosts: "h:27017", authMethod: "none" },
    });
    expect(r.success).toBe(true);
  });
});

describe("connToConfig", () => {
  const parse = (partial: Record<string, unknown>) =>
    connToConfig(connectionSchemaParse(partial));
  const connectionSchemaParse = (partial: Record<string, unknown>) =>
    migrationFormSchema.parse({ ...base, source: partial }).source;

  it("returns a raw passthrough when raw is set", () => {
    expect(parse({ raw: "mongodb://x/" })).toEqual({ raw: "mongodb://x/" });
  });

  it("maps password auth with mechanism + authSource", () => {
    expect(
      parse({
        scheme: "mongodb",
        hosts: "h:27017",
        authMethod: "password",
        username: "u",
        password: "p",
        authMechanism: "SCRAM-SHA-256",
        authSource: "admin",
      })
    ).toEqual({
      scheme: "mongodb",
      hosts: ["h:27017"],
      authMethod: "password",
      username: "u",
      password: "p",
      authMechanism: "SCRAM-SHA-256",
      authSource: "admin",
    });
  });

  it("maps kerberos SERVICE_NAME into authMechanismProperties", () => {
    const c = parse({
      scheme: "mongodb",
      hosts: "h:1",
      authMethod: "kerberos",
      username: "user@REALM",
      serviceName: "mongodb",
    });
    expect(c.authMechanismProperties).toEqual({ SERVICE_NAME: "mongodb" });
  });

  it("maps aws session token + tls CA", () => {
    const c = parse({
      scheme: "mongodb",
      hosts: "h:1",
      authMethod: "aws",
      username: "AK",
      password: "secret",
      awsSessionToken: "tok",
      tlsEnabled: true,
      tlsCaFile: "/c/ca.pem",
    });
    expect(c.authMechanismProperties).toEqual({ AWS_SESSION_TOKEN: "tok" });
    expect(c.tls).toEqual({ enabled: true, caFile: "/c/ca.pem" });
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
