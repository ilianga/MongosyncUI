import { describe, it, expect } from "vitest";
import {
  comparePrivileges,
  summarize,
  deriveChecks,
  REQUIRED_ACTIONS,
  SUFFICIENT_ROLES,
  type Privilege,
  type AuthRole,
  type ClusterFacts,
  type PreflightCheck,
} from "@/lib/preflight";

function privWithActions(actions: string[]): Privilege[] {
  return [{ resource: { db: "", collection: "" }, actions }];
}

describe("comparePrivileges", () => {
  it("reports missing required actions", () => {
    const have = privWithActions(["insert", "createCollection"]);
    const { missing } = comparePrivileges(have, REQUIRED_ACTIONS.destination);
    expect(missing).toContain("enableSharding");
    expect(missing).toContain("bypassDocumentValidation");
    expect(missing).not.toContain("insert");
  });

  it("returns no missing when all required actions are granted", () => {
    const have = privWithActions([...REQUIRED_ACTIONS.destination]);
    expect(comparePrivileges(have, REQUIRED_ACTIONS.destination).missing).toEqual([]);
  });

  it("flattens actions across multiple privilege entries", () => {
    const have: Privilege[] = [
      { resource: { cluster: true }, actions: ["enableSharding"] },
      { resource: { db: "", collection: "" }, actions: REQUIRED_ACTIONS.destination.filter((a) => a !== "enableSharding") },
    ];
    expect(comparePrivileges(have, REQUIRED_ACTIONS.destination).missing).toEqual([]);
  });

  it("role-based fallback: a sufficient built-in role satisfies all required actions", () => {
    const roles: AuthRole[] = [{ role: "root", db: "admin" }];
    const res = comparePrivileges([], REQUIRED_ACTIONS.destination, roles, SUFFICIENT_ROLES.destination);
    expect(res.missing).toEqual([]);
    expect(res.satisfiedByRole).toBe("root");
  });

  it("ignores roles not in the sufficient set", () => {
    const roles: AuthRole[] = [{ role: "read", db: "foo" }];
    const res = comparePrivileges([], REQUIRED_ACTIONS.destination, roles, SUFFICIENT_ROLES.destination);
    expect(res.satisfiedByRole).toBeUndefined();
    expect(res.missing.length).toBeGreaterThan(0);
  });

  it("auth-disabled empty privilege set yields all required as missing", () => {
    const res = comparePrivileges([], REQUIRED_ACTIONS.destination, [], SUFFICIENT_ROLES.destination);
    expect(res.missing).toEqual([...REQUIRED_ACTIONS.destination]);
  });
});

describe("summarize", () => {
  const mk = (status: PreflightCheck["status"]): PreflightCheck => ({
    id: status,
    label: status,
    side: "both",
    status,
    detail: "",
  });

  it("returns fail when any check fails", () => {
    expect(summarize([mk("pass"), mk("warn"), mk("fail")])).toBe("fail");
  });

  it("returns warn when warns but no fails", () => {
    expect(summarize([mk("pass"), mk("warn"), mk("skip")])).toBe("warn");
  });

  it("returns pass when only passes/skips", () => {
    expect(summarize([mk("pass"), mk("skip"), mk("pass")])).toBe("pass");
  });

  it("ignores skip in the rollup", () => {
    expect(summarize([mk("skip")])).toBe("pass");
  });
});

// ── deriveChecks: report shaping from facts ──────────────────────────────────

const goodFacts = (over: Partial<ClusterFacts> = {}): ClusterFacts => ({
  reachable: true,
  pingOk: true,
  setName: "rs0",
  version: "7.0.5",
  authenticated: true,
  privileges: [],
  roles: [{ role: "root", db: "admin" }],
  userDatabases: [],
  hasSyncState: false,
  oplogWindowSec: 7200,
  isSharded: false,
  ...over,
});

function byId(checks: PreflightCheck[], id: string): PreflightCheck {
  const c = checks.find((x) => x.id === id);
  if (!c) throw new Error(`no check ${id}`);
  return c;
}

describe("deriveChecks", () => {
  it("all-green facts produce a passing report", () => {
    const checks = deriveChecks(goodFacts(), goodFacts(), {});
    expect(summarize(checks)).toBe("pass");
    // Every spec'd check id is present (per side where applicable).
    const ids = checks.map((c) => c.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "reachable.source",
        "reachable.destination",
        "replicaSet.source",
        "replicaSet.destination",
        "authenticated.source",
        "authenticated.destination",
        "privileges.source",
        "privileges.destination",
        "versionCompatibility",
        "destinationEmpty",
        "leftoverSyncState",
        "oplogWindow",
      ])
    );
  });

  it("standalone destination fails the replica-set check", () => {
    const checks = deriveChecks(goodFacts(), goodFacts({ setName: null }), {});
    expect(byId(checks, "replicaSet.destination").status).toBe("fail");
    expect(summarize(checks)).toBe("fail");
  });

  it("auth-disabled (empty privileges, not authenticated) fails the DESTINATION privileges", () => {
    const dest = goodFacts({ authenticated: false, privileges: [], roles: [] });
    const checks = deriveChecks(goodFacts(), dest, {});
    expect(byId(checks, "privileges.destination").status).toBe("fail");
  });

  it("auth-disabled source privileges warn rather than fail", () => {
    const source = goodFacts({ authenticated: false, privileges: [], roles: [] });
    const checks = deriveChecks(source, goodFacts(), {});
    expect(byId(checks, "privileges.source").status).toBe("warn");
  });

  it("non-empty destination fails unless preExistingDestinationData is set", () => {
    const dest = goodFacts({ userDatabases: ["app"] });
    expect(byId(deriveChecks(goodFacts(), dest, {}), "destinationEmpty").status).toBe("fail");
    expect(
      byId(deriveChecks(goodFacts(), dest, { preExistingDestinationData: true }), "destinationEmpty").status
    ).toBe("warn");
  });

  it("leftover sync state on destination warns", () => {
    const checks = deriveChecks(goodFacts(), goodFacts({ hasSyncState: true }), {});
    expect(byId(checks, "leftoverSyncState").status).toBe("warn");
  });

  it("leftover sync state on the SOURCE warns (host that was a prior destination)", () => {
    const checks = deriveChecks(goodFacts({ hasSyncState: true }), goodFacts(), {});
    expect(byId(checks, "leftoverSyncState.source").status).toBe("warn");
    expect(byId(checks, "leftoverSyncState").status).toBe("pass"); // dest is clean
  });

  it("differing majors warn for one-way, fail when reversible", () => {
    const source = goodFacts({ version: "6.0.1" });
    const dest = goodFacts({ version: "7.0.5" });
    expect(byId(deriveChecks(source, dest, {}), "versionCompatibility").status).toBe("warn");
    expect(byId(deriveChecks(source, dest, { reversible: true }), "versionCompatibility").status).toBe("fail");
  });

  it("small oplog window warns", () => {
    const checks = deriveChecks(goodFacts({ oplogWindowSec: 600 }), goodFacts(), {});
    expect(byId(checks, "oplogWindow").status).toBe("warn");
  });

  it("unreachable side fails reachable and skips dependent checks", () => {
    const checks = deriveChecks(goodFacts(), { reachable: false, error: "refused" }, {});
    expect(byId(checks, "reachable.destination").status).toBe("fail");
    expect(byId(checks, "replicaSet.destination").status).toBe("skip");
    expect(byId(checks, "privileges.destination").status).toBe("skip");
    expect(summarize(checks)).toBe("fail");
  });

  it("authentication error surfaces as authenticated fail", () => {
    const dest = goodFacts({ error: "Authentication failed: bad auth", authenticated: false });
    const checks = deriveChecks(goodFacts(), dest, {});
    expect(byId(checks, "authenticated.destination").status).toBe("fail");
  });

  // ── sharded-cluster checks: balancer state + shard zone tags ───────────────

  const shardedOff = (over: Partial<ClusterFacts> = {}): ClusterFacts =>
    goodFacts({ isSharded: true, balancerEnabled: false, zoneTagNamespaces: [], ...over });

  it("non-sharded clusters skip the balancer and zone-tag checks", () => {
    const checks = deriveChecks(goodFacts(), goodFacts(), {});
    expect(byId(checks, "balancerState.source").status).toBe("skip");
    expect(byId(checks, "balancerState.destination").status).toBe("skip");
    expect(byId(checks, "shardZoneTags").status).toBe("skip");
    expect(byId(checks, "balancerState.source").detail).toMatch(/Not a sharded cluster/);
  });

  it("sharded clusters with balancer off pass the balancer checks", () => {
    const checks = deriveChecks(shardedOff(), shardedOff(), {});
    expect(byId(checks, "balancerState.source").status).toBe("pass");
    expect(byId(checks, "balancerState.destination").status).toBe("pass");
  });

  it("destination balancer on fails", () => {
    const checks = deriveChecks(shardedOff(), shardedOff({ balancerEnabled: true }), {});
    const c = byId(checks, "balancerState.destination");
    expect(c.status).toBe("fail");
    expect(c.remediation).toMatch(/15 min/);
    expect(summarize(checks)).toBe("fail");
  });

  it("source balancer on with no namespace filter fails", () => {
    const checks = deriveChecks(shardedOff({ balancerEnabled: true }), shardedOff(), {});
    const c = byId(checks, "balancerState.source");
    expect(c.status).toBe("fail");
    expect(c.remediation).toMatch(/15 min/);
  });

  it("source balancer on with a namespace filter warns (include)", () => {
    const config = { includeNamespaces: [{ database: "app" }] };
    const checks = deriveChecks(shardedOff({ balancerEnabled: true }), shardedOff(), config);
    const c = byId(checks, "balancerState.source");
    expect(c.status).toBe("warn");
    expect(c.remediation).toMatch(/disableBalancing|in-scope|filtered/i);
  });

  it("source balancer on with an exclude filter also warns", () => {
    const config = { excludeNamespaces: [{ database: "logs" }] };
    const checks = deriveChecks(shardedOff({ balancerEnabled: true }), shardedOff(), config);
    expect(byId(checks, "balancerState.source").status).toBe("warn");
  });

  it("destination shard zone/tag ranges fail", () => {
    const dest = shardedOff({ zoneTagNamespaces: ["app.orders"] });
    const checks = deriveChecks(shardedOff(), dest, {});
    const c = byId(checks, "shardZoneTags");
    expect(c.status).toBe("fail");
    expect(c.detail).toMatch(/app\.orders/);
    expect(c.remediation).toMatch(/COMMITTED/);
    expect(summarize(checks)).toBe("fail");
  });

  it("sharded destination with no zone tags passes", () => {
    const checks = deriveChecks(shardedOff(), shardedOff(), {});
    expect(byId(checks, "shardZoneTags").status).toBe("pass");
  });

  it("unreachable sharded side skips the new checks", () => {
    const checks = deriveChecks(shardedOff(), { reachable: false, error: "refused" }, {});
    expect(byId(checks, "balancerState.destination").status).toBe("skip");
    expect(byId(checks, "shardZoneTags").status).toBe("skip");
  });
});
