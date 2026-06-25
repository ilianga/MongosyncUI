import { z } from "zod";
import type { NamespaceFilter, StartConfig, ConnectionConfig } from "./types";

/**
 * Extract the normalised host set from a MongoDB connection string. Strips the scheme,
 * any userinfo, the path/query, lowercases, and defaults the port to 27017 so that e.g.
 * "mongodb://h" and "mongodb://h:27017" compare equal. Returns an empty set for input
 * with no host part. Pure (no node imports) so it is safe to use in shared/zod code and
 * easy to unit-test.
 */
export function connectionHostSet(uri: string): Set<string> {
  const withoutScheme = uri.replace(/^mongodb(\+srv)?:\/\//i, "");
  const afterAuth = withoutScheme.includes("@")
    ? withoutScheme.slice(withoutScheme.indexOf("@") + 1)
    : withoutScheme;
  const hostPart = afterAuth.split("/")[0].split("?")[0];
  const hosts = hostPart
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
    .map((h) => (h.includes(":") ? h : `${h}:27017`));
  return new Set(hosts);
}

/**
 * True when two connection strings resolve to the same set of hosts — used to reject a
 * migration whose source and destination point at the same cluster. Conservative: an
 * empty/unparseable host set never matches (so we don't block on garbage input here).
 */
export function sameHostSet(uriA: string, uriB: string): boolean {
  const a = connectionHostSet(uriA);
  const b = connectionHostSet(uriB);
  if (a.size === 0 || b.size === 0) return false;
  if (a.size !== b.size) return false;
  for (const h of a) if (!b.has(h)) return false;
  return true;
}

export const namespaceRowSchema = z.object({
  database: z.string().default(""),
  databaseRegex: z.string().default(""),
  collections: z.string().default(""), // comma-separated in the UI
  collectionsRegex: z.string().default(""),
});

// Structured per-cluster connection. Mirrors ConnectionConfig; the builder turns it into
// a connection string on submit. `raw` is the advanced "paste a connection string" hatch.
export const connectionSchema = z
  .object({
    raw: z.string().default(""),
    scheme: z.enum(["mongodb", "mongodb+srv"]).default("mongodb"),
    hosts: z.string().default(""), // comma-separated host:port in the UI
    authMethod: z
      .enum(["none", "password", "x509", "kerberos", "ldap", "aws", "oidc"])
      .default("none"),
    username: z.string().default(""),
    password: z.string().default(""),
    authSource: z.string().default(""),
    authMechanism: z.enum(["DEFAULT", "SCRAM-SHA-1", "SCRAM-SHA-256"]).default("DEFAULT"),
    serviceName: z.string().default(""), // kerberos SERVICE_NAME
    // Additive auth fields are .optional() (not .default) so existing callers that build the
    // form-values object literally (e.g. saved-connections page) don't have to enumerate them.
    serviceRealm: z.string().optional(), // kerberos SERVICE_REALM
    canonicalizeHostName: z.boolean().optional(), // kerberos CANONICALIZE_HOST_NAME
    awsSessionToken: z.string().default(""),
    oidcEnvironment: z.string().optional(), // OIDC ENVIRONMENT (azure | gcp | k8s | test)
    oidcTokenResource: z.string().optional(), // OIDC TOKEN_RESOURCE (audience)
    tlsEnabled: z.boolean().default(false),
    tlsCaFile: z.string().default(""), // staged absolute path (set after upload)
    tlsCertKeyFile: z.string().default(""), // staged absolute path (set after upload)
    tlsCertKeyPassword: z.string().default(""),
    tlsAllowInvalidCertificates: z.boolean().default(false),
    tlsAllowInvalidHostnames: z.boolean().default(false),
  })
  .superRefine((c, ctx) => {
    // Either a raw connection string, or at least one host in structured mode.
    if (!c.raw.trim() && !c.hosts.split(",").some((h) => h.trim())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide at least one host (or paste a connection string)",
        path: ["hosts"],
      });
    }
  });

export type ConnectionFormValues = z.output<typeof connectionSchema>;

/** Turn the flat connection form values into a structured ConnectionConfig for the API. */
export function connToConfig(c: ConnectionFormValues): ConnectionConfig {
  if (c.raw.trim()) return { raw: c.raw.trim() };

  const conn: ConnectionConfig = {
    scheme: c.scheme,
    hosts: c.hosts.split(",").map((h) => h.trim()).filter(Boolean),
    authMethod: c.authMethod,
  };
  if (c.username.trim()) conn.username = c.username.trim();
  if (c.password) conn.password = c.password;

  if (c.authMethod === "password") {
    if (c.authMechanism !== "DEFAULT") conn.authMechanism = c.authMechanism;
    if (c.authSource.trim()) conn.authSource = c.authSource.trim();
  }

  const props: Record<string, string> = {};
  if (c.authMethod === "kerberos") {
    if (c.serviceName.trim()) props.SERVICE_NAME = c.serviceName.trim();
    if (c.serviceRealm?.trim()) props.SERVICE_REALM = c.serviceRealm.trim();
    if (c.canonicalizeHostName) props.CANONICALIZE_HOST_NAME = "true";
  }
  if (c.authMethod === "aws" && c.awsSessionToken.trim())
    props.AWS_SESSION_TOKEN = c.awsSessionToken.trim();
  if (c.authMethod === "oidc") {
    if (c.oidcEnvironment?.trim()) props.ENVIRONMENT = c.oidcEnvironment.trim();
    if (c.oidcTokenResource?.trim()) props.TOKEN_RESOURCE = c.oidcTokenResource.trim();
  }
  if (Object.keys(props).length) conn.authMechanismProperties = props;

  if (c.tlsEnabled) {
    conn.tls = { enabled: true };
    if (c.tlsCaFile.trim()) conn.tls.caFile = c.tlsCaFile.trim();
    if (c.tlsCertKeyFile.trim()) conn.tls.certKeyFile = c.tlsCertKeyFile.trim();
    if (c.tlsCertKeyPassword) conn.tls.certKeyPassword = c.tlsCertKeyPassword;
    if (c.tlsAllowInvalidCertificates) conn.tls.allowInvalidCertificates = true;
    if (c.tlsAllowInvalidHostnames) conn.tls.allowInvalidHostnames = true;
  }
  return conn;
}

/**
 * Reverse of connToConfig: load a stored ConnectionConfig back into flat connection form
 * values so the builder can be populated when a saved connection is picked (or edited).
 */
export function configToConnForm(conn: ConnectionConfig): ConnectionFormValues {
  const props = conn.authMechanismProperties ?? {};
  return {
    raw: conn.raw ?? "",
    scheme: conn.scheme ?? "mongodb",
    hosts: (conn.hosts ?? []).join(", "),
    authMethod: conn.authMethod ?? "none",
    username: conn.username ?? "",
    password: conn.password ?? "",
    authSource: conn.authSource ?? "",
    authMechanism: conn.authMechanism ?? "DEFAULT",
    serviceName: props.SERVICE_NAME ?? "",
    serviceRealm: props.SERVICE_REALM ?? "",
    canonicalizeHostName: props.CANONICALIZE_HOST_NAME === "true",
    awsSessionToken: props.AWS_SESSION_TOKEN ?? "",
    oidcEnvironment: props.ENVIRONMENT ?? "",
    oidcTokenResource: props.TOKEN_RESOURCE ?? "",
    tlsEnabled: conn.tls?.enabled ?? false,
    tlsCaFile: conn.tls?.caFile ?? "",
    tlsCertKeyFile: conn.tls?.certKeyFile ?? "",
    tlsCertKeyPassword: conn.tls?.certKeyPassword ?? "",
    tlsAllowInvalidCertificates: conn.tls?.allowInvalidCertificates ?? false,
    tlsAllowInvalidHostnames: conn.tls?.allowInvalidHostnames ?? false,
  };
}

// Server-side validation for a structured ConnectionConfig payload (saved-connection API).
// Mirrors lib/connection.ts ConnectionConfig; all fields optional so partial configs and
// the raw passthrough both validate.
export const connectionConfigSchema = z.object({
  raw: z.string().optional(),
  scheme: z.enum(["mongodb", "mongodb+srv"]).optional(),
  hosts: z.array(z.string()).optional(),
  authMethod: z.enum(["none", "password", "x509", "kerberos", "ldap", "aws", "oidc"]).optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  authSource: z.string().optional(),
  authMechanism: z.enum(["DEFAULT", "SCRAM-SHA-1", "SCRAM-SHA-256"]).optional(),
  authMechanismProperties: z.record(z.string(), z.string()).optional(),
  tls: z
    .object({
      enabled: z.boolean().optional(),
      caFile: z.string().optional(),
      certKeyFile: z.string().optional(),
      certKeyPassword: z.string().optional(),
      allowInvalidCertificates: z.boolean().optional(),
      allowInvalidHostnames: z.boolean().optional(),
    })
    .optional(),
});

// Create/update payloads for a saved connection.
export const savedConnectionSchema = z.object({
  name: z.string().min(1, "Name is required"),
  color: z.string().min(1, "Color is required"),
  conn: connectionConfigSchema,
});

export const savedConnectionUpdateSchema = savedConnectionSchema.partial();

export const shardingEntrySchema = z.object({
  database: z.string().min(1),
  collection: z.string().min(1),
  shardKey: z.string().min(1), // "field:1, other:hashed" parsed on submit
});

export const migrationFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  source: connectionSchema,
  dest: connectionSchema,
  reversible: z.boolean().default(false),
  buildIndexes: z
    .enum(["afterDataCopy", "beforeDataCopy", "excludeHashed", "excludeHashedAfterCopy", "never"])
    .default("beforeDataCopy"),
  detectRandomId: z.boolean().default(true),
  preExistingDestinationData: z.boolean().default(false),
  verificationEnabled: z.boolean().default(false),
  loadLevel: z.number().min(1).max(4).default(3),
  verbosity: z.enum(["TRACE", "DEBUG", "INFO", "WARN", "ERROR", "FATAL", "PANIC"]).default("INFO"),
  // Optional index-build batch size (1–64). Empty/0 means "leave to mongosync".
  createIndexesBatchSize: z.number().min(1).max(64).optional(),
  // Optional (output) so existing MigrationFormValues literals that predate these fields
  // stay valid; the form supplies a concrete default via useForm's defaultValues.
  enableCappedCollectionHandling: z.boolean().optional(),
  // Hot (frequently-updated) document IDs as a JSON string (textarea); parsed on submit.
  hotDocIDs: z
    .string()
    .optional()
    .refine(
      (s) => {
        if (!s || !s.trim()) return true;
        try {
          JSON.parse(s);
          return true;
        } catch {
          return false;
        }
      },
      { message: "Must be valid JSON" }
    ),
  includeNamespaces: z.array(namespaceRowSchema).default([]),
  excludeNamespaces: z.array(namespaceRowSchema).default([]),
  // rs → sharded destination: create the destination collections' supporting indexes.
  createSupportingIndexes: z.boolean().optional(),
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

  if (values.createIndexesBatchSize !== undefined)
    cfg.createIndexesBatchSize = values.createIndexesBatchSize;
  if (values.enableCappedCollectionHandling) cfg.enableCappedCollectionHandling = true;
  if (values.hotDocIDs && values.hotDocIDs.trim()) {
    try {
      cfg.hotDocIDs = JSON.parse(values.hotDocIDs);
    } catch {
      /* schema validation guards this; ignore unparseable input defensively */
    }
  }

  const inc = values.includeNamespaces.map(rowToFilter).filter((x): x is NamespaceFilter => x !== null);
  const exc = values.excludeNamespaces.map(rowToFilter).filter((x): x is NamespaceFilter => x !== null);
  if (inc.length) cfg.includeNamespaces = inc;
  if (exc.length) cfg.excludeNamespaces = exc;

  if (values.shardingEntries.length) {
    cfg.sharding = {
      ...(values.createSupportingIndexes ? { createSupportingIndexes: true } : {}),
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
