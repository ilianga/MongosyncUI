import net from "node:net";
import { runMongoshEval, runMongoshJson } from "./mongosh";

export interface ClusterCheck {
  reachable: boolean;
  version?: string;
  /** True if the node is a replica set member. mongosync requires this on both ends. */
  isReplicaSet?: boolean;
  /** Non-fatal advisory surfaced to the user (e.g. standalone node). */
  warning?: string;
  error?: string;
}

export function parseMongoUri(uri: string): { hosts: string[] } {
  const withoutScheme = uri.replace(/^mongodb(\+srv)?:\/\//, "");
  const afterAuth = withoutScheme.includes("@")
    ? withoutScheme.slice(withoutScheme.indexOf("@") + 1)
    : withoutScheme;
  const hostPart = afterAuth.split("/")[0].split("?")[0];
  const hosts = hostPart.split(",").map((h) => {
    const trimmed = h.trim();
    return trimmed.includes(":") ? trimmed : `${trimmed}:27017`;
  });
  return { hosts };
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
  let hosts: string[];
  try {
    hosts = parseMongoUri(uri).hosts;
  } catch {
    return { reachable: false, error: "Could not parse URI" };
  }
  const [host, portStr] = hosts[0].split(":");
  const reachable = await tcpProbe(host, Number(portStr));
  if (!reachable) return { reachable: false, error: `Cannot reach ${hosts[0]}` };

  // Best-effort probe via mongosh if present; failure is non-fatal. We read both
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
  } catch {
    return { reachable: true };
  }
}
