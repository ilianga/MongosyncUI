import type { StartConfig } from "./types";
import { runMongoshJson } from "./mongosh";

// mongosync's reported `estimatedTotalBytes` is discovered in stages and starts far too
// low, so copy progress (copied/total) can spike toward 100% and then collapse when the
// estimate jumps. To give a stable, monotonic denominator we compute the real total
// ourselves from the source: the sum of each in-scope collection's uncompressed data
// size (collStats.size), which matches the unit mongosync uses for estimatedCopiedBytes.
//
// The namespace-filter matching below mirrors mongosync's include/exclude semantics so a
// filtered sync (e.g. a single database) gets a correct total, not the whole cluster.
const TOTAL_SCRIPT = `
function reMatch(rx, val) {
  if (!rx || !rx.pattern) return false;
  try { return new RegExp(rx.pattern, rx.options || "").test(val); } catch (e) { return false; }
}
function entryMatches(e, dbn, coll) {
  var dbMatch = false;
  if (e.database != null && e.database !== "") dbMatch = e.database === dbn;
  else if (e.databaseRegex) dbMatch = reMatch(e.databaseRegex, dbn);
  if (!dbMatch) return false;
  var hasColl = (e.collections && e.collections.length) || (e.collectionsRegex && e.collectionsRegex.pattern);
  if (!hasColl) return true;
  if (e.collections && e.collections.indexOf(coll) !== -1) return true;
  return reMatch(e.collectionsRegex, coll);
}
function inScope(dbn, coll) {
  var inc = filter.include || [], exc = filter.exclude || [];
  var included = inc.length === 0 ? true : inc.some(function (e) { return entryMatches(e, dbn, coll); });
  if (!included) return false;
  return !exc.some(function (e) { return entryMatches(e, dbn, coll); });
}
var total = 0;
db.adminCommand({ listDatabases: 1 }).databases.forEach(function (d) {
  if (["admin", "local", "config"].indexOf(d.name) !== -1) return;
  var sdb = db.getSiblingDB(d.name);
  sdb.getCollectionInfos({}, true).forEach(function (ci) {
    if (ci.type === "view") return;
    if (ci.name.indexOf("system.") === 0) return;
    if (!inScope(d.name, ci.name)) return;
    try { total += Number(sdb.runCommand({ collStats: ci.name }).size) || 0; } catch (e) {}
  });
});
print(JSON.stringify({ total: total }));
`;

/**
 * Sum the uncompressed data size of every in-scope collection on the source. Returns the
 * byte total, or null if it cannot be computed (mongosh missing, unreachable, parse error)
 * so callers can fall back to mongosync's own estimate.
 */
export async function computeSourceTotalBytes(uri: string, cfg: StartConfig): Promise<number | null> {
  const filter = JSON.stringify({
    include: cfg.includeNamespaces ?? [],
    exclude: cfg.excludeNamespaces ?? [],
  });
  const script = `var filter = ${filter};\n${TOTAL_SCRIPT}`;
  try {
    const parsed = await runMongoshJson<{ total: number }>(uri, script, { timeoutMs: 20000 });
    return Number.isFinite(parsed.total) && parsed.total > 0 ? parsed.total : null;
  } catch {
    return null;
  }
}
