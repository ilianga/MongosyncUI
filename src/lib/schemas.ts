import { z } from "zod";
import type { NamespaceFilter, StartConfig } from "./types";

export const namespaceRowSchema = z.object({
  database: z.string().default(""),
  databaseRegex: z.string().default(""),
  collections: z.string().default(""), // comma-separated in the UI
  collectionsRegex: z.string().default(""),
});

export const shardingEntrySchema = z.object({
  database: z.string().min(1),
  collection: z.string().min(1),
  shardKey: z.string().min(1), // "field:1, other:hashed" parsed on submit
});

export const migrationFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  sourceUri: z.string().startsWith("mongodb", "Must be a mongodb:// or mongodb+srv:// URI"),
  destUri: z.string().startsWith("mongodb", "Must be a mongodb:// or mongodb+srv:// URI"),
  reversible: z.boolean().default(false),
  buildIndexes: z
    .enum(["afterDataCopy", "beforeDataCopy", "excludeHashed", "excludeHashedAfterCopy", "never"])
    .default("afterDataCopy"),
  detectRandomId: z.boolean().default(true),
  preExistingDestinationData: z.boolean().default(false),
  verificationEnabled: z.boolean().default(true),
  loadLevel: z.number().min(1).max(4).default(3),
  verbosity: z.enum(["TRACE", "DEBUG", "INFO", "WARN", "ERROR", "FATAL", "PANIC"]).default("INFO"),
  includeNamespaces: z.array(namespaceRowSchema).default([]),
  excludeNamespaces: z.array(namespaceRowSchema).default([]),
  shardingEntries: z.array(shardingEntrySchema).default([]),
});

export type MigrationFormValues = z.output<typeof migrationFormSchema>;
type NamespaceRow = z.output<typeof namespaceRowSchema>;

function rowToFilter(row: NamespaceRow): NamespaceFilter | null {
  const f: NamespaceFilter = {};
  if (row.database.trim()) f.database = row.database.trim();
  else if (row.databaseRegex.trim()) f.databaseRegex = { pattern: row.databaseRegex.trim() };
  else return null; // a row needs at least a database or databaseRegex
  const cols = row.collections.split(",").map((c) => c.trim()).filter(Boolean);
  if (cols.length) f.collections = cols;
  if (row.collectionsRegex.trim()) f.collectionsRegex = { pattern: row.collectionsRegex.trim() };
  return f;
}

export function formValuesToConfig(values: MigrationFormValues): StartConfig {
  const cfg: StartConfig = {
    buildIndexes: values.buildIndexes,
    reversible: values.reversible,
    detectRandomId: values.detectRandomId,
    preExistingDestinationData: values.preExistingDestinationData,
    verificationEnabled: values.verificationEnabled,
    verbosity: values.verbosity,
  };
  if (values.loadLevel !== 3) cfg.loadLevel = values.loadLevel;

  const inc = values.includeNamespaces.map(rowToFilter).filter((x): x is NamespaceFilter => x !== null);
  const exc = values.excludeNamespaces.map(rowToFilter).filter((x): x is NamespaceFilter => x !== null);
  if (inc.length) cfg.includeNamespaces = inc;
  if (exc.length) cfg.excludeNamespaces = exc;

  if (values.shardingEntries.length) {
    cfg.sharding = {
      shardingEntries: values.shardingEntries.map((e) => ({
        database: e.database,
        collection: e.collection,
        shardCollection: {
          key: e.shardKey
            .split(",")
            .map((part) => {
              const [field, dir] = part.split(":").map((s) => s.trim());
              if (!field) return null;
              const val: 1 | -1 | "hashed" = dir === "hashed" ? "hashed" : dir === "-1" ? -1 : 1;
              return { [field]: val };
            })
            .filter((x): x is Record<string, 1 | -1 | "hashed"> => x !== null),
        },
      })),
    };
  }
  return cfg;
}
