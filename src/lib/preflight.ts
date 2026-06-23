import net from "node:net";
import { buildConnectionString, type ConnectionConfig } from "./connection";
import { parseMongoUri, MONGOSYNC_STATE_DB } from "./cluster-check";
import type { StartConfig } from "./types";
import { runMongoshEval } from "./mongosh";

// ─────────────────────────────────────────────────────────────────────────────
// Types (kept local per file-ownership rules)
// ─────────────────────────────────────────────────────────────────────────────

export type PreflightStatus = "pass" | "warn" | "fail" | "skip";
export type PreflightSide = "source" | "destination" | "both";

export interface PreflightCheck {
  id: string;
  label: string;
  side: PreflightSide;
  status: PreflightStatus;
  detail: string;
  remediation?: string;
}

export interface PreflightReport {
  checks: PreflightCheck[];
  overall: "pass" | "warn" | "fail";
}

/** One entry of connectionStatus.authInfo.authenticatedUserPrivileges. */
export interface Privilege {
  resource: { db?: string; collection?: string; cluster?: boolean; anyResource?: boolean };
  actions: string[];
}

/** A role from connectionStatus.authInfo.authenticatedUserRoles. */
export interface AuthRole {
  role: string;
  db: string;
}

/** Raw facts gathered from one cluster in a single mongosh eval. */
export interface ClusterFacts {
  reachable: boolean;
  pingOk?: boolean;
  setName?: string | null;
  version?: string;
  /** True if connectionStatus reports an authenticated user. */
  authenticated?: boolean;
  privileges?: Privilege[];
  roles?: AuthRole[];
  /** Non-system, non-internal database names. */
  userDatabases?: string[];
  /** True if __mdb_internal_mongosync exists. */
  hasSyncState?: boolean;
  /** Oplog window in seconds (last ts − first ts). */
  oplogWindowSec?: number | null;
  /** Error string when the eval failed (mongosh missing, auth failed, etc.). */
  error?: string;
}

export interface PreflightInput {
  sourceUri?: string;
  destUri?: string;
  sourceConn?: ConnectionConfig;
  destConn?: ConnectionConfig;
  config?: StartConfig;
}

// ─────────────────────────────────────────────────────────────────────────────
// Required actions / roles (from mongosync docs)
// ─────────────────────────────────────────────────────────────────────────────

// The destination needs broad write + cluster-management privileges. mongosync
// enumerates these explicitly at init and rejects the destination when any are
// missing (notably the case when authorization is disabled → empty privileges).
export const REQUIRED_ACTIONS = {
  source: ["find", "changeStream", "collStats", "listCollections", "listDatabases"],
  destination: [
    "enableSharding",
    "insert",
    "createCollection",
    "bypassDocumentValidation",
    "createIndex",
    "dropCollection",
    "dropDatabase",
    "listCollections",
    "listDatabases",
  ],
} as const;

// Built-in roles that, if held, satisfy the privilege requirement for a side
// regardless of the explicit privilege enumeration (role-based fallback).
export const SUFFICIENT_ROLES = {
  source: ["root", "readAnyDatabase", "backup", "clusterMonitor", "readWriteAnyDatabase"],
  destination: ["root", "readWriteAnyDatabase", "restore", "clusterManager"],
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Pure logic (unit-tested)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compare the actions a user holds (across all granted privileges) against a
 * required action set. We flatten every privilege's actions because mongosync's
 * required actions span the cluster resource and the "any database" resource;
 * a missing action means mongosync will reject the side.
 *
 * Role-based fallback: if the user holds one of `sufficientRoles`, treat all
 * required actions as satisfied (a built-in role like `root`/`readWriteAnyDatabase`
 * grants them implicitly even if the privilege enumeration is shaped differently).
 */
export function comparePrivileges(
  have: Privilege[],
  requiredActions: readonly string[],
  roles: AuthRole[] = [],
  sufficientRoles: readonly string[] = []
): { missing: string[]; satisfiedByRole?: string } {
  const roleHit = roles.find((r) => sufficientRoles.includes(r.role));
  if (roleHit) return { missing: [], satisfiedByRole: roleHit.role };

  const granted = new Set<string>();
  for (const priv of have) {
    for (const action of priv.actions ?? []) granted.add(action);
  }
  const missing = requiredActions.filter((a) => !granted.has(a));
  return { missing };
}

/** Severity rollup: fail wins over warn wins over pass. skip is ignored. */
export function summarize(checks: PreflightCheck[]): "pass" | "warn" | "fail" {
  if (checks.some((c) => c.status === "fail")) return "fail";
  if (checks.some((c) => c.status === "warn")) return "warn";
  return "pass";
}

// ─────────────────────────────────────────────────────────────────────────────
// Fact gathering (one mongosh eval per side)
// ─────────────────────────────────────────────────────────────────────────────

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

// A single eval that returns every fact we need. Errors inside (e.g. not
// authorized for connectionStatus showPrivileges) are caught per-field so a
// partial result still comes back as JSON.
const FACTS_EVAL = `
(async function () {
  // async-aware: mongosh rewrites DB calls to awaited promises, so a sync try/catch
  // can't catch their throws. Awaiting fn() inside safe() catches both sync and async
  // failures, which matters because preflight targets possibly-underprivileged users.
  async function safe(fn, dflt) { try { return await fn(); } catch (e) { return dflt; } }
  var out = {};
  out.pingOk = await safe(function () { return db.adminCommand({ ping: 1 }).ok === 1; }, false);
  out.version = await safe(function () { return db.version(); }, null);
  out.setName = await safe(function () { return db.hello().setName || null; }, null);
  var cs = await safe(function () { return db.runCommand({ connectionStatus: 1, showPrivileges: true }); }, null);
  if (cs && cs.authInfo) {
    out.authenticated = (cs.authInfo.authenticatedUsers || []).length > 0;
    out.privileges = cs.authInfo.authenticatedUserPrivileges || [];
    out.roles = cs.authInfo.authenticatedUserRoles || [];
  } else {
    out.authenticated = false; out.privileges = []; out.roles = [];
  }
  out.userDatabases = await safe(function () {
    var names = db.getMongo().getDBNames();
    var sys = { admin: 1, local: 1, config: 1 };
    return names.filter(function (n) {
      return !sys[n] && n.indexOf('__mdb_internal') !== 0;
    });
  }, []);
  out.hasSyncState = await safe(function () {
    return db.getMongo().getDBNames().indexOf(${JSON.stringify(MONGOSYNC_STATE_DB)}) !== -1;
  }, false);
  out.oplogWindowSec = await safe(function () {
    var oplog = db.getSiblingDB('local').oplog.rs;
    var first = oplog.find().sort({ $natural: 1 }).limit(1).next();
    var last = oplog.find().sort({ $natural: -1 }).limit(1).next();
    // oplog ts is a BSON Timestamp; its .t field is seconds since epoch (no getTime()).
    if (!first || !last || !first.ts || !last.ts) return null;
    return last.ts.t - first.ts.t;
  }, null);
  return JSON.stringify(out);
})()
`;

async function gatherFacts(uri: string): Promise<ClusterFacts> {
  // Reachability via TCP probe first so a wholly-unreachable host fails fast and
  // clearly instead of waiting on mongosh's longer connect timeout.
  let reachable = false;
  try {
    const hosts = parseMongoUri(uri).hosts;
    const [host, portStr] = hosts[0].split(":");
    reachable = await tcpProbe(host, Number(portStr));
  } catch {
    return { reachable: false, error: "Could not parse URI" };
  }
  if (!reachable) return { reachable: false, error: "TCP connection refused or timed out" };

  try {
    const stdout = await runMongoshEval(uri, FACTS_EVAL, { timeoutMs: 12000 });
    const parsed = JSON.parse(stdout) as Omit<ClusterFacts, "reachable">;
    return { reachable: true, ...parsed };
  } catch (e) {
    // mongosh present but the eval failed — most commonly an auth failure. (A missing
    // mongosh binary surfaces here too, via MongoshNotFoundError's message.) The original
    // error text is preserved in the normalised message so looksLikeAuthError still matches.
    const msg = (e as Error).message || String(e);
    return { reachable: true, authenticated: false, error: msg };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Check derivation (thin, given facts)
// ─────────────────────────────────────────────────────────────────────────────

const ONE_HOUR_MS = 60 * 60 * 1000;

function looksLikeAuthError(msg: string): boolean {
  return /auth|Authentication|not authorized|requires authentication|SCRAM|bad auth/i.test(msg);
}

export function deriveChecks(
  source: ClusterFacts,
  dest: ClusterFacts,
  config: StartConfig
): PreflightCheck[] {
  const checks: PreflightCheck[] = [];
  const sides = [
    ["source", source],
    ["destination", dest],
  ] as const;

  // 1. reachable (per side)
  for (const [side, facts] of sides) {
    checks.push({
      id: `reachable.${side}`,
      label: `${cap(side)} reachable`,
      side,
      status: facts.reachable ? "pass" : "fail",
      detail: facts.reachable
        ? "TCP connection succeeded."
        : facts.error || "Could not reach the cluster.",
      remediation: facts.reachable
        ? undefined
        : "Check the host/port and that the cluster is running and accepts connections.",
    });
  }

  // 2. replicaSet (per side)
  for (const [side, facts] of sides) {
    if (!facts.reachable) {
      checks.push(skip(`replicaSet.${side}`, `${cap(side)} is a replica set`, side, "Cluster unreachable; skipped."));
      continue;
    }
    if (facts.setName === undefined) {
      checks.push(skip(`replicaSet.${side}`, `${cap(side)} is a replica set`, side, facts.error || "Could not read replica-set status."));
      continue;
    }
    const isRs = !!facts.setName;
    checks.push({
      id: `replicaSet.${side}`,
      label: `${cap(side)} is a replica set`,
      side,
      status: isRs ? "pass" : "fail",
      detail: isRs
        ? `Replica set "${facts.setName}".`
        : "Node is a standalone. mongosync requires a replica set on both ends.",
      remediation: isRs ? undefined : "Restart mongod with --replSet <name> and run rs.initiate().",
    });
  }

  // 3. authenticated (per side)
  for (const [side, facts] of sides) {
    if (!facts.reachable) {
      checks.push(skip(`authenticated.${side}`, `${cap(side)} credentials authenticate`, side, "Cluster unreachable; skipped."));
      continue;
    }
    if (facts.error && looksLikeAuthError(facts.error)) {
      checks.push({
        id: `authenticated.${side}`,
        label: `${cap(side)} credentials authenticate`,
        side,
        status: "fail",
        detail: `Authentication failed: ${facts.error}`,
        remediation: "Check the username/password and authSource (mongosync expects authSource=admin).",
      });
      continue;
    }
    // authenticated === false with authorization disabled is allowed (no users);
    // we surface that nuance in the privileges check, not here.
    checks.push({
      id: `authenticated.${side}`,
      label: `${cap(side)} credentials authenticate`,
      side,
      status: "pass",
      detail: facts.authenticated
        ? "Connected as an authenticated user."
        : "Connected (no authenticated user — authorization may be disabled).",
    });
  }

  // 4. privileges (per side)
  const privSpecs = [
    ["source", source, REQUIRED_ACTIONS.source, SUFFICIENT_ROLES.source],
    ["destination", dest, REQUIRED_ACTIONS.destination, SUFFICIENT_ROLES.destination],
  ] as const;
  for (const [side, facts, required, roles] of privSpecs) {
    if (!facts.reachable || facts.privileges === undefined) {
      checks.push(
        skip(
          `privileges.${side}`,
          `${cap(side)} user has required privileges`,
          side,
          facts.reachable ? facts.error || "Could not read privileges." : "Cluster unreachable; skipped."
        )
      );
      continue;
    }

    const authDisabled = !facts.authenticated && (facts.privileges?.length ?? 0) === 0;
    const { missing, satisfiedByRole } = comparePrivileges(facts.privileges, required, facts.roles ?? [], roles);

    if (authDisabled && side === "destination") {
      // Verified: with authorization disabled, authenticatedUserPrivileges is empty
      // and mongosync rejects the DESTINATION (Missing privileges: enableSharding,
      // insert, createCollection, bypassDocumentValidation, …).
      checks.push({
        id: `privileges.${side}`,
        label: `${cap(side)} user has required privileges`,
        side,
        status: "fail",
        detail:
          "Authorization appears disabled — privilege set is empty. mongosync requires an authenticated user with write + cluster-management privileges on the destination and will reject it.",
        remediation:
          "Enable authorization on the destination and connect as a user with clusterManager + readWriteAnyDatabase + restore (or root for local testing).",
      });
      continue;
    }
    if (authDisabled && side === "source") {
      // Source frequently passes mongosync's init even with an empty AnyDB
      // privilege set — surface a warning rather than a hard fail.
      checks.push({
        id: `privileges.${side}`,
        label: `${cap(side)} user has required privileges`,
        side,
        status: "warn",
        detail:
          "Authorization appears disabled — could not verify source privileges. mongosync usually accepts the source in this state, but enabling auth is recommended.",
        remediation: "Connect as a user with read access (readAnyDatabase / clusterMonitor / backup) on the source.",
      });
      continue;
    }

    if (missing.length === 0) {
      checks.push({
        id: `privileges.${side}`,
        label: `${cap(side)} user has required privileges`,
        side,
        status: "pass",
        detail: satisfiedByRole
          ? `Granted via built-in role "${satisfiedByRole}".`
          : "All required actions are granted.",
      });
    } else {
      checks.push({
        id: `privileges.${side}`,
        label: `${cap(side)} user has required privileges`,
        side,
        status: "fail",
        detail: `Missing privileges: ${missing.join(", ")}.`,
        remediation:
          side === "destination"
            ? "Grant clusterManager + readWriteAnyDatabase + clusterMonitor + backup + restore on the destination (or root for local testing)."
            : "Grant read roles (readAnyDatabase / clusterMonitor / backup) on the source (or root for local testing).",
      });
    }
  }

  // 5. versionCompatibility (both)
  {
    const sv = parseMajor(source.version);
    const dv = parseMajor(dest.version);
    if (sv === null || dv === null) {
      checks.push(
        skip("versionCompatibility", "Source and destination versions compatible", "both", "Could not read one or both MongoDB versions.")
      );
    } else if (sv === dv) {
      checks.push({
        id: "versionCompatibility",
        label: "Source and destination versions compatible",
        side: "both",
        status: "pass",
        detail: `Both clusters are MongoDB ${sv}.x.`,
      });
    } else if (config.reversible) {
      checks.push({
        id: "versionCompatibility",
        label: "Source and destination versions compatible",
        side: "both",
        status: "fail",
        detail: `Major versions differ (source ${sv}.x vs destination ${dv}.x). Reverse sync requires equal major versions.`,
        remediation: "Match the major versions, or disable reversible.",
      });
    } else {
      checks.push({
        id: "versionCompatibility",
        label: "Source and destination versions compatible",
        side: "both",
        status: "warn",
        detail: `Major versions differ (source ${sv}.x vs destination ${dv}.x). Acceptable for a one-way sync; reversible/sharded features need 6.0+ and equal majors.`,
      });
    }
  }

  // 6. destinationEmpty
  if (!dest.reachable || dest.userDatabases === undefined) {
    checks.push(
      skip(
        "destinationEmpty",
        "Destination has no user data",
        "destination",
        dest.reachable ? dest.error || "Could not list destination databases." : "Cluster unreachable; skipped."
      )
    );
  } else if (dest.userDatabases.length === 0) {
    checks.push({
      id: "destinationEmpty",
      label: "Destination has no user data",
      side: "destination",
      status: "pass",
      detail: "Destination has no user databases.",
    });
  } else if (config.preExistingDestinationData) {
    checks.push({
      id: "destinationEmpty",
      label: "Destination has no user data",
      side: "destination",
      status: "warn",
      detail: `Destination has data (${dest.userDatabases.join(", ")}), but "Allow pre-existing destination data" is enabled.`,
    });
  } else {
    checks.push({
      id: "destinationEmpty",
      label: "Destination has no user data",
      side: "destination",
      status: "fail",
      detail: `Destination already has data (${dest.userDatabases.join(", ")}). mongosync refuses a non-empty destination.`,
      remediation: 'Enable "Allow pre-existing destination data", or drop the existing databases.',
    });
  }

  // 7. leftoverSyncState
  if (!dest.reachable || dest.hasSyncState === undefined) {
    checks.push(
      skip(
        "leftoverSyncState",
        "No leftover mongosync state on destination",
        "destination",
        dest.reachable ? dest.error || "Could not check for sync state." : "Cluster unreachable; skipped."
      )
    );
  } else if (dest.hasSyncState) {
    checks.push({
      id: "leftoverSyncState",
      label: "No leftover mongosync state on destination",
      side: "destination",
      status: "warn",
      detail: `${MONGOSYNC_STATE_DB} is present — mongosync will try to resume the old run instead of starting fresh.`,
      remediation: 'Drop the leftover state (the "Drop sync state" action / POST /api/cluster-check/drop-sync-state).',
    });
  } else {
    checks.push({
      id: "leftoverSyncState",
      label: "No leftover mongosync state on destination",
      side: "destination",
      status: "pass",
      detail: "No leftover sync state found.",
    });
  }

  // 8. oplogWindow (source)
  if (!source.reachable) {
    checks.push(skip("oplogWindow", "Source oplog window is healthy", "source", "Cluster unreachable; skipped."));
  } else if (source.oplogWindowSec === undefined || source.oplogWindowSec === null) {
    checks.push(skip("oplogWindow", "Source oplog window is healthy", "source", "Could not read the source oplog window."));
  } else {
    const sec = source.oplogWindowSec;
    const human = humanDuration(sec);
    if (sec * 1000 < ONE_HOUR_MS) {
      checks.push({
        id: "oplogWindow",
        label: "Source oplog window is healthy",
        side: "source",
        status: "warn",
        detail: `Source oplog window is only ~${human}. A small window risks falling behind during a long migration.`,
        remediation: "Increase the source oplog size for long-running migrations.",
      });
    } else {
      checks.push({
        id: "oplogWindow",
        label: "Source oplog window is healthy",
        side: "source",
        status: "pass",
        detail: `Source oplog window is ~${human}.`,
      });
    }
  }

  return checks;
}

// ─────────────────────────────────────────────────────────────────────────────
// Orchestrator
// ─────────────────────────────────────────────────────────────────────────────

export async function runPreflight(input: PreflightInput): Promise<PreflightReport> {
  const config = input.config ?? {};
  let sourceUri: string;
  let destUri: string;
  try {
    sourceUri = input.sourceUri ?? buildConnectionString(input.sourceConn ?? {});
    destUri = input.destUri ?? buildConnectionString(input.destConn ?? {});
  } catch (e) {
    return {
      overall: "fail",
      checks: [
        {
          id: "input",
          label: "Connection input",
          side: "both",
          status: "fail",
          detail: `Could not build connection strings: ${(e as Error).message}`,
        },
      ],
    };
  }

  const [source, dest] = await Promise.all([
    gatherFacts(sourceUri).catch((e) => ({ reachable: false, error: (e as Error).message } as ClusterFacts)),
    gatherFacts(destUri).catch((e) => ({ reachable: false, error: (e as Error).message } as ClusterFacts)),
  ]);

  const checks = deriveChecks(source, dest, config);
  return { checks, overall: summarize(checks) };
}

// ─────────────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────────────

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function skip(id: string, label: string, side: PreflightSide, detail: string): PreflightCheck {
  return { id, label, side, status: "skip", detail };
}

function parseMajor(version?: string): number | null {
  if (!version) return null;
  const m = /^(\d+)\./.exec(version);
  return m ? Number(m[1]) : null;
}

function humanDuration(sec: number): string {
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  if (sec < 86400) return `${Math.round((sec / 3600) * 10) / 10}h`;
  return `${Math.round((sec / 86400) * 10) / 10}d`;
}
