import { runMongoshJson } from "./mongosh";

export interface IndexBuild {
  ns: string;
  /** Documents scanned so far (collection-scan phase); 0 once past scanning. */
  done: number;
  /** Total documents to scan; 0 when the server isn't reporting scan progress. */
  total: number;
  /** Scan progress 0-100, or null when no scan progress is available (e.g. drain phase). */
  pct: number | null;
}

// mongosync's /progress.indexBuilding only counts COMPLETED builds, so it shows "0 of N"
// for the entire (often long) build phase. To show real progress we read the destination's
// in-progress index builds from $currentOp. This needs the `inprog` privilege on the
// cluster, granted by the clusterMonitor role (and root) — both in mongosync's recommended
// destination role set.
const SCRIPT = `
var ops = db.getSiblingDB("admin").aggregate([{ $currentOp: { allUsers: true, idleConnections: false } }]).toArray();
var byNs = {};
ops.forEach(function (o) {
  var isBuild = /IndexBuild/i.test(o.desc || "") || /Index Build/i.test(o.msg || "");
  if (!isBuild || !o.ns) return;
  if (/^(admin|config|local)\\./.test(o.ns)) return;
  var done = o.progress ? Number(o.progress.done) || 0 : 0;
  var total = o.progress ? Number(o.progress.total) || 0 : 0;
  var prev = byNs[o.ns];
  // Keep the richest entry per namespace (the coordinator op carries scan progress).
  if (!prev || total > prev.total) byNs[o.ns] = { ns: o.ns, done: done, total: total };
});
var builds = Object.keys(byNs).map(function (k) { return byNs[k]; });
print(JSON.stringify({ builds: builds }));
`;

/**
 * In-progress index builds on the destination. Returns [] when none are running and null
 * when it couldn't be queried (mongosh missing, unreachable, or insufficient privileges),
 * so the UI can distinguish "nothing building" from "can't tell".
 */
export async function getIndexBuilds(uri: string): Promise<IndexBuild[] | null> {
  try {
    const parsed = await runMongoshJson<{ builds: { ns: string; done: number; total: number }[] }>(
      uri,
      SCRIPT,
      { timeoutMs: 8000 }
    );
    return parsed.builds.map((b) => ({
      ns: b.ns,
      done: b.done,
      total: b.total,
      pct: b.total > 0 ? Math.min(100, Math.max(0, (b.done / b.total) * 100)) : null,
    }));
  } catch {
    return null;
  }
}
