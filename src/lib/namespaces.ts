import { runMongoshJson } from "./mongosh";

export interface NamespaceCollection {
  name: string;
  /** "collection" | "view" | "timeseries" — best-effort from listCollections.type. */
  type: string;
}

export interface NamespaceDatabase {
  name: string;
  collections: NamespaceCollection[];
}

export interface NamespaceListing {
  databases: NamespaceDatabase[];
}

/** System databases mongosync never syncs and that we must hide from the explorer. */
const SYSTEM_DBS = new Set(["admin", "local", "config"]);

/**
 * True if a database name should be hidden from the namespace explorer: the fixed
 * system databases plus mongosync's own internal state databases (`__mdb_internal*`).
 */
export function isHiddenDatabase(name: string): boolean {
  if (SYSTEM_DBS.has(name)) return true;
  if (name.startsWith("__mdb_internal")) return true;
  return false;
}

/**
 * True if a collection name should be hidden: anything `system.*` (system namespaces
 * cannot be filtered/synced) or a mongosync internal collection.
 */
export function isHiddenCollection(name: string): boolean {
  if (name.startsWith("system.")) return true;
  if (name.startsWith("__mdb_internal")) return true;
  return false;
}

/** Shape returned by the in-shell aggregation/listing script (before filtering). */
interface RawListing {
  databases: { name: string; collections: { name: string; type?: string }[] }[];
}

/**
 * Turn the raw mongosh listing into the filtered, public {@link NamespaceListing}:
 * drops system/internal databases and collections, normalises collection `type`,
 * and sorts databases + collections alphabetically. Pure — unit-tested directly.
 */
export function parseNamespaceListing(raw: RawListing): NamespaceListing {
  const databases = (raw.databases ?? [])
    .filter((d) => d && typeof d.name === "string" && !isHiddenDatabase(d.name))
    .map((d) => ({
      name: d.name,
      collections: (d.collections ?? [])
        .filter((c) => c && typeof c.name === "string" && !isHiddenCollection(c.name))
        .map((c) => ({ name: c.name, type: c.type || "collection" }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { databases };
}

// Lists every user database and its collections/views in one round-trip. We use the
// driver-level calls so a single eval returns structured JSON. getCollectionInfos with
// nameOnly=true keeps it cheap on large clusters, and we fall back to getCollectionNames
// if listCollections metadata isn't permitted.
const SCRIPT = `
var out = [];
db.getMongo().getDBNames().forEach(function (name) {
  var sdb = db.getSiblingDB(name);
  var cols = [];
  try {
    sdb.getCollectionInfos({}, true).forEach(function (ci) {
      cols.push({ name: ci.name, type: ci.type || "collection" });
    });
  } catch (e) {
    try {
      sdb.getCollectionNames().forEach(function (n) { cols.push({ name: n, type: "collection" }); });
    } catch (e2) { /* leave cols empty */ }
  }
  out.push({ name: name, collections: cols });
});
print(JSON.stringify({ databases: out }));
`;

/**
 * List user databases + their collections/views on the cluster at `uri`.
 * Excludes admin/local/config, `__mdb_internal*`, and `system.*`.
 *
 * Throws (propagating from {@link runMongoshJson}) when mongosh is missing/unreachable
 * or returns non-JSON, so the API route can convert it into a clear error response.
 */
export async function listNamespaces(uri: string): Promise<NamespaceListing> {
  const raw = await runMongoshJson<RawListing>(uri, SCRIPT, { timeoutMs: 12000 });
  return parseNamespaceListing(raw);
}
