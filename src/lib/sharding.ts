import { runMongoshJson, isMongoshNotFound } from "./mongosh";

// Result of probing a cluster's topology via `listShards`. A replica set (or a
// standalone) is NOT a sharded cluster, so `listShards` fails with a recognisable
// error there; we translate that to `null` so callers can branch on "sharded vs not".

interface ListShardsResult {
  ok?: number;
  shards?: { _id?: string }[];
}

/**
 * Return the source cluster's shard ids (the `_id`s from `listShards`), or `null`
 * when the cluster is NOT sharded (a replica set / standalone) or when topology
 * cannot be determined (mongosh missing/unreachable). A sharded cluster always
 * reports at least one shard, so a non-empty array means "treat as sharded".
 *
 * mongosync requires ONE instance per SOURCE shard for sharded → sharded syncs,
 * each launched with `--id <shardId>`; this is the detection that drives that.
 */
export async function listSourceShards(uri: string): Promise<string[] | null> {
  return listShards(uri);
}

/**
 * Shared `listShards` probe. Returns the shard ids, or `null` when the cluster is
 * not sharded / cannot be queried. Used for both the source (to decide multi-instance)
 * and the destination (to compare shard counts for `reversible`).
 */
export async function listShards(uri: string): Promise<string[] | null> {
  // Connecting a mongos and running `listShards` returns the shard catalog. On a
  // replica set the command does not exist, so it throws — caught in-script → ok:0.
  const script = `
    try {
      var r = db.getSiblingDB("admin").runCommand({ listShards: 1 });
      print(JSON.stringify({ ok: r.ok, shards: (r.shards || []).map(function (s) { return { _id: s._id }; }) }));
    } catch (e) {
      print(JSON.stringify({ ok: 0 }));
    }
  `;
  let parsed: ListShardsResult;
  try {
    parsed = await runMongoshJson<ListShardsResult>(uri, script, { timeoutMs: 10000 });
  } catch (e) {
    // mongosh missing/unreachable or non-JSON output: topology is unknown.
    if (isMongoshNotFound(e)) return null;
    return null;
  }
  if (!parsed.ok || !Array.isArray(parsed.shards) || parsed.shards.length === 0) {
    return null;
  }
  const ids = parsed.shards
    .map((s) => (typeof s._id === "string" ? s._id.trim() : ""))
    .filter((id) => id.length > 0);
  return ids.length > 0 ? ids : null;
}

/**
 * Assign a unique port to each source shard, starting at `basePort` and skipping
 * any ports already in use. Pure and deterministic given its inputs. Returns one
 * `{ shardId, port }` per shard, in the order shard ids are given.
 */
export function assignInstancePorts(
  shardIds: string[],
  basePort: number,
  usedPorts: Iterable<number>
): { shardId: string; port: number }[] {
  const used = new Set<number>(usedPorts);
  const out: { shardId: string; port: number }[] = [];
  let port = basePort;
  for (const shardId of shardIds) {
    while (used.has(port)) port++;
    used.add(port);
    out.push({ shardId, port });
    port++;
  }
  return out;
}
