import { probeReachable, MONGOSYNC_STATE_DB } from "./cluster-check";
import { runMongoshEval, isMongoshNotFound } from "./mongosh";
import { maskUri } from "./format";
import {
  comparePrivileges,
  WRITE_BLOCKING_ACTIONS,
  WRITE_BLOCKING_ROLES,
  type Privilege,
  type AuthRole,
} from "./preflight";

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface DoctorCheck {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail" | "skip";
  detail: string;
  remediation?: string;
}

export interface DoctorReport {
  reachable: boolean;
  version?: string;
  checks: DoctorCheck[];
  overall: "pass" | "warn" | "fail";
}

// ─────────────────────────────────────────────────────────────────────────────
// Recommended built-in roles (from mongosync docs). The Connection Doctor checks
// a SINGLE cluster against the role set for the role it would play in a sync.
// ─────────────────────────────────────────────────────────────────────────────

const RECOMMENDED_ROLES = {
  source: ["backup", "clusterManager", "clusterMonitor", "readWriteAnyDatabase", "restore"],
  destination: ["clusterManager", "clusterMonitor", "readWriteAnyDatabase", "restore"],
} as const;

// A user holding any of these is a superset of the recommended roles and passes outright.
const SUPERSET_ROLES = ["root", "atlasAdmin"] as const;

const ONE_HOUR_SEC = 60 * 60;

// ─────────────────────────────────────────────────────────────────────────────
// Facts gathered from the cluster in a single mongosh eval (own slim version,
// mirroring preflight's FACTS_EVAL / source-stats so we touch the cluster once).
// ─────────────────────────────────────────────────────────────────────────────

interface DoctorFacts {
  pingOk?: boolean;
  version?: string | null;
  setName?: string | null;
  authenticated?: boolean;
  privileges?: Privilege[];
  roles?: AuthRole[];
  hasSyncState?: boolean;
  oplogWindowSec?: number | null;
}

const FACTS_EVAL = `
(async function () {
  // async-aware safe(): mongosh rewrites DB calls to awaited promises, so awaiting fn()
  // inside catches both sync and async failures (important for under-privileged users).
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
  out.hasSyncState = await safe(function () {
    return db.getMongo().getDBNames().indexOf(${JSON.stringify(MONGOSYNC_STATE_DB)}) !== -1;
  }, false);
  out.oplogWindowSec = await safe(function () {
    var oplog = db.getSiblingDB('local').oplog.rs;
    var first = oplog.find().sort({ $natural: 1 }).limit(1).next();
    var last = oplog.find().sort({ $natural: -1 }).limit(1).next();
    // oplog ts is a BSON Timestamp; .t is seconds since epoch.
    if (!first || !last || !first.ts || !last.ts) return null;
    return last.ts.t - first.ts.t;
  }, null);
  return JSON.stringify(out);
})()
`;

function looksLikeAuthError(msg: string): boolean {
  return /auth|Authentication|not authorized|requires authentication|SCRAM|bad auth/i.test(msg);
}

function humanDuration(sec: number): string {
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  if (sec < 86400) return `${Math.round((sec / 3600) * 10) / 10}h`;
  return `${Math.round((sec / 86400) * 10) / 10}d`;
}

function summarize(checks: DoctorCheck[]): "pass" | "warn" | "fail" {
  if (checks.some((c) => c.status === "fail")) return "fail";
  if (checks.some((c) => c.status === "warn")) return "warn";
  return "pass";
}

// ─────────────────────────────────────────────────────────────────────────────
// Orchestrator
// ─────────────────────────────────────────────────────────────────────────────

export async function runConnectionDoctor(
  uri: string,
  role: "source" | "destination"
): Promise<DoctorReport> {
  // 1. Reachable — SRV-aware (DNS SRV for mongodb+srv, TCP for direct hosts). Fail fast.
  const probe = await probeReachable(uri);
  if (!probe.reachable) {
    return {
      reachable: false,
      overall: "fail",
      checks: [
        {
          id: "reachable",
          label: "Cluster reachable",
          status: "fail",
          detail: probe.error || "Could not reach the cluster.",
          remediation:
            "Check the host/port (or SRV record) and that the cluster is running and accepts connections from this machine.",
        },
      ],
    };
  }

  // Gather every other fact in one eval. Errors degrade per-fact below.
  let facts: DoctorFacts | null = null;
  let evalError: string | null = null;
  try {
    const stdout = await runMongoshEval(uri, FACTS_EVAL, { timeoutMs: 12000 });
    facts = JSON.parse(stdout) as DoctorFacts;
  } catch (e) {
    if (isMongoshNotFound(e)) {
      // mongosh missing: reachability passed but we cannot inspect anything else.
      return {
        reachable: true,
        overall: "warn",
        checks: [
          { id: "reachable", label: "Cluster reachable", status: "pass", detail: "Connection probe succeeded." },
          {
            id: "mongosh",
            label: "mongosh available for diagnostics",
            status: "warn",
            detail: "mongosh is not installed or not on PATH, so deeper checks were skipped.",
            remediation: "Install mongosh and ensure it is on PATH to run the full diagnostic battery.",
          },
        ],
      };
    }
    evalError = maskUri((e as Error).message || String(e));
  }

  const checks: DoctorCheck[] = [];

  // 1. Reachable (pass).
  checks.push({
    id: "reachable",
    label: "Cluster reachable",
    status: "pass",
    detail: facts?.pingOk ? "Connection probe + ping succeeded." : "Connection probe succeeded.",
  });

  // 2. Authenticated.
  if (evalError && looksLikeAuthError(evalError)) {
    checks.push({
      id: "authenticated",
      label: "Credentials authenticate",
      status: "fail",
      detail: `Authentication failed: ${evalError}`,
      remediation:
        "Check the username/password and authSource (mongosync expects authSource=admin). mongosync cannot run against an auth-disabled cluster — its preflight reads the user's privilege list, which is empty without auth.",
    });
  } else if (facts?.authenticated) {
    checks.push({
      id: "authenticated",
      label: "Credentials authenticate",
      status: "pass",
      detail: "Connected as an authenticated user.",
    });
  } else if (evalError) {
    checks.push({
      id: "authenticated",
      label: "Credentials authenticate",
      status: "fail",
      detail: `Could not establish an authenticated session: ${evalError}`,
      remediation: "Verify the connection credentials and that the user exists with authSource=admin.",
    });
  } else {
    checks.push({
      id: "authenticated",
      label: "Credentials authenticate",
      status: "fail",
      detail:
        "Connected but no authenticated user (authorization appears disabled). mongosync cannot run against an auth-disabled cluster — its preflight reads the user's privilege list, which is empty without auth.",
      remediation: "Enable authorization and connect as a privileged user (root for local testing).",
    });
  }

  // 3. Replica set.
  if (facts?.setName === undefined) {
    checks.push({
      id: "replicaSet",
      label: "Cluster is a replica set",
      status: "skip",
      detail: evalError || "Could not read replica-set status.",
    });
  } else if (facts.setName) {
    checks.push({
      id: "replicaSet",
      label: "Cluster is a replica set",
      status: "pass",
      detail: `Replica set "${facts.setName}".`,
    });
  } else {
    checks.push({
      id: "replicaSet",
      label: "Cluster is a replica set",
      status: "fail",
      detail: "Node is a standalone. mongosync requires a replica set (it reads the oplog).",
      remediation: "Restart mongod with --replSet <name> and run rs.initiate().",
    });
  }

  // 4. Server version (info/pass).
  if (facts?.version) {
    checks.push({
      id: "version",
      label: "Server version detected",
      status: "pass",
      detail: `MongoDB ${facts.version}.`,
    });
  } else {
    checks.push({
      id: "version",
      label: "Server version detected",
      status: "skip",
      detail: evalError || "Could not read the MongoDB version.",
    });
  }

  // 5. Recommended roles / privileges for the intended role.
  {
    const label = `User has recommended ${role} roles`;
    const roles = facts?.roles;
    if (roles === undefined) {
      checks.push({
        id: "roles",
        label,
        status: "skip",
        detail: evalError || "Could not read the user's roles.",
      });
    } else if (!facts?.authenticated && (facts?.privileges?.length ?? 0) === 0) {
      checks.push({
        id: "roles",
        label,
        status: "warn",
        detail: "No authenticated privileges to inspect (authorization may be disabled).",
        remediation: `Connect as a user holding ${RECOMMENDED_ROLES[role].join(", ")} (or root/atlasAdmin).`,
      });
    } else {
      const held = new Set(roles.map((r) => r.role));
      const superset = SUPERSET_ROLES.find((r) => held.has(r));
      const recommended = RECOMMENDED_ROLES[role];
      const missing = recommended.filter((r) => !held.has(r));
      if (superset) {
        checks.push({
          id: "roles",
          label,
          status: "pass",
          detail: `Granted via superset role "${superset}".`,
        });
      } else if (missing.length === 0) {
        checks.push({
          id: "roles",
          label,
          status: "pass",
          detail: `All recommended ${role} roles present (${recommended.join(", ")}). clusterMonitor also enables live index-build progress.`,
        });
      } else {
        checks.push({
          id: "roles",
          label,
          status: "warn",
          detail: `Missing recommended ${role} role(s): ${missing.join(", ")}.`,
          remediation: `Grant ${missing.join(", ")} (or root/atlasAdmin). Note: clusterMonitor also enables the UI's live index-build progress.`,
        });
      }
    }
  }

  // 6. Oplog window (source emphasis).
  {
    const label = "Oplog window is healthy";
    if (facts?.oplogWindowSec === undefined) {
      checks.push({ id: "oplogWindow", label, status: "skip", detail: evalError || "Could not read the oplog window." });
    } else if (facts.oplogWindowSec === null) {
      checks.push({ id: "oplogWindow", label, status: "skip", detail: "Oplog window not determinable on this node." });
    } else if (facts.oplogWindowSec < ONE_HOUR_SEC) {
      checks.push({
        id: "oplogWindow",
        label,
        status: "warn",
        detail: `Oplog window is only ~${humanDuration(facts.oplogWindowSec)}. A small window risks falling behind during a long migration${role === "source" ? " (this cluster is being tested as the source)" : ""}.`,
        remediation: "Increase the oplog size for long-running migrations.",
      });
    } else {
      checks.push({
        id: "oplogWindow",
        label,
        status: "pass",
        detail: `Oplog window is ~${humanDuration(facts.oplogWindowSec)}.`,
      });
    }
  }

  // 7. Leftover mongosync state.
  {
    const label = "No leftover mongosync state";
    if (facts?.hasSyncState === undefined) {
      checks.push({ id: "leftoverSyncState", label, status: "skip", detail: evalError || "Could not check for sync state." });
    } else if (facts.hasSyncState) {
      checks.push({
        id: "leftoverSyncState",
        label,
        status: "warn",
        detail: `${MONGOSYNC_STATE_DB} is present — a prior run left state on this cluster. mongosync may try to resume the old run instead of starting fresh, or refuse to start with a cluster-id mismatch.`,
        remediation: 'Drop the leftover state before a fresh sync (the "Drop sync state" action).',
      });
    } else {
      checks.push({ id: "leftoverSyncState", label, status: "pass", detail: "No leftover sync state found." });
    }
  }

  // 8. Write-blocking actions (destination only). NO role fallback beyond root — atlasAdmin
  // does NOT grant these, which is exactly the gap users hit at commit. Best-effort → warn.
  if (role === "destination") {
    const label = "Can block writes at commit (setUserWriteBlockMode/bypassWriteBlockingMode)";
    const privileges = facts?.privileges;
    if (privileges === undefined) {
      checks.push({ id: "writeBlocking", label, status: "skip", detail: evalError || "Could not read privileges." });
    } else if (!facts?.authenticated && privileges.length === 0) {
      checks.push({ id: "writeBlocking", label, status: "skip", detail: "Could not verify (no authenticated privileges)." });
    } else {
      const { missing, satisfiedByRole } = comparePrivileges(
        privileges,
        WRITE_BLOCKING_ACTIONS,
        facts?.roles ?? [],
        WRITE_BLOCKING_ROLES
      );
      if (missing.length === 0) {
        checks.push({
          id: "writeBlocking",
          label,
          status: "pass",
          detail: satisfiedByRole
            ? `Granted via built-in role "${satisfiedByRole}".`
            : "User has setUserWriteBlockMode + bypassWriteBlockingMode.",
        });
      } else {
        checks.push({
          id: "writeBlocking",
          label,
          status: "warn",
          detail: `User is missing ${missing.join(", ")}. mongosync needs these to enable write-blocking at commit; note these are NOT granted by atlasAdmin.`,
          remediation:
            "Grant a role authorized with setUserWriteBlockMode and bypassWriteBlockingMode. On Atlas: atlasAdmin plus a custom role with those two cluster actions; self-managed: included in root.",
        });
      }
    }
  }

  return {
    reachable: true,
    version: facts?.version ?? undefined,
    checks,
    overall: summarize(checks),
  };
}
