import net from "node:net";
import { promises as dns } from "node:dns";
import { runMongoshEval, runMongoshJson, isMongoshNotFound } from "./mongosh";
import { maskUri } from "./format";

export interface ClusterCheck {
  reachable: boolean;
  version?: string;
  /** True if the node is a replica set member. mongosync requires this on both ends. */
  isReplicaSet?: boolean;
  /** Non-fatal advisory surfaced to the user (e.g. standalone node). */
  warning?: string;
  error?: string;
}

export function parseMongoUri(uri: string): { hosts: string[]; srv: boolean } {
  const srv = /^mongodb\+srv:\/\//i.test(uri);
  const withoutScheme = uri.replace(/^mongodb(\+srv)?:\/\//, "");
  const afterAuth = withoutScheme.includes("@")
    ? withoutScheme.slice(withoutScheme.indexOf("@") + 1)
    : withoutScheme;
  const hostPart = afterAuth.split("/")[0].split("?")[0];
  const hosts = hostPart.split(",").map((h) => {
    const trimmed = h.trim();
    return trimmed.includes(":") ? trimmed : `${trimmed}:27017`;
  });
  return { hosts, srv };
}

/**
 * Reachability pre-check. For `mongodb+srv://`, the bare SRV hostname has no A record
 * and accepts no connections — TCP-probing it always fails. Resolve the DNS SRV record
 * instead. For direct/replica-set URIs, TCP-probe the first host:port. The authoritative
 * check is still the mongosh handshake in checkCluster; this just fails fast & clearly.
 */
export async function probeReachable(uri: string): Promise<{ reachable: boolean; error?: string }> {
  let parsed: { hosts: string[]; srv: boolean };
  try {
    parsed = parseMongoUri(uri);
  } catch {
    return { reachable: false, error: "Could not parse URI" };
  }
  const first = parsed.hosts[0] ?? "";
  if (parsed.srv) {
    const domain = first.split(":")[0];
    try {
      const records = await dns.resolveSrv(`_mongodb._tcp.${domain}`);
      if (records && records.length > 0) return { reachable: true };
      return { reachable: false, error: `No SRV records found for ${domain}` };
    } catch {
      return { reachable: false, error: `Cannot resolve SRV record for ${domain}` };
    }
  }
  const [host, portStr] = first.split(":");
  const ok = await tcpProbe(host, Number(portStr));
  return ok ? { reachable: true } : { reachable: false, error: `Cannot reach ${first}` };
}

function tcpProbe(host: string, port: number, timeoutMs = 4000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
    socket.connect(port, host);
  });
}

/** Database mongosync uses on the destination to persist resumable sync state. */
export const MONGOSYNC_STATE_DB = "__mdb_internal_mongosync";

/**
 * True if the destination already holds mongosync sync state from a previous run.
 * On startup mongosync auto-resumes that state instead of reaching IDLE, which makes
 * a fresh "start" hang. Detecting it lets the UI offer to drop it. Throws if mongosh
 * is unavailable or the cluster cannot be queried, so callers can fall back.
 */
export async function hasSyncState(uri: string): Promise<boolean> {
  const parsed = await runMongoshJson<{ has: boolean }>(
    uri,
    `JSON.stringify({ has: db.getMongo().getDBNames().includes(${JSON.stringify(MONGOSYNC_STATE_DB)}) })`,
    { timeoutMs: 8000 }
  );
  return parsed.has === true;
}

/** Drop mongosync's resumable-state database on the destination so the next run starts fresh. */
export async function dropSyncState(uri: string): Promise<void> {
  await runMongoshEval(
    uri,
    `db.getSiblingDB(${JSON.stringify(MONGOSYNC_STATE_DB)}).dropDatabase()`,
    { timeoutMs: 8000 }
  );
}

export async function checkCluster(uri: string): Promise<ClusterCheck> {
  // SRV-aware reachability (DNS SRV for mongodb+srv, TCP for direct hosts).
  const probe = await probeReachable(uri);
  if (!probe.reachable) return { reachable: false, error: probe.error };

  // Authoritative probe via mongosh. We read both
  // the version and replica-set membership in one shot. mongosync requires BOTH
  // source and destination to be replica sets (it reads the oplog / uses read
  // concern), so a standalone node fails fatally at init with NotAReplicaSet —
  // catch it here with a clear warning instead of a cryptic crash on start.
  try {
    const parsed = await runMongoshJson<{ v: string; rs: boolean }>(
      uri,
      "JSON.stringify({ v: db.version(), rs: !!db.hello().setName })",
      { timeoutMs: 8000 }
    );
    const result: ClusterCheck = { reachable: true, version: parsed.v, isReplicaSet: parsed.rs };
    if (!parsed.rs) {
      result.warning =
        "Node is a standalone, not a replica set. mongosync requires a replica set on both source and destination. Restart mongod with --replSet and run rs.initiate().";
    }
    return result;
  } catch (e) {
    // mongosh missing → can't verify, but the pre-check passed, so report reachable.
    if (isMongoshNotFound(e)) return { reachable: true };
    // mongosh ran but the handshake failed (auth, TLS, IP allow-list, timeout) — for SRV
    // there was no TCP confirmation, so surface the real reason rather than a false "ok".
    return { reachable: false, error: maskUri((e as Error).message) };
  }
}
