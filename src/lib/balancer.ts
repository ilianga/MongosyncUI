import { runMongoshEval, MongoshNotFoundError, isMongoshNotFound } from "./mongosh";

/**
 * Semi-automatic balancer control for sharded clusters.
 *
 * mongosync requires the (destination) balancer to be off during a migration, and a
 * full source sync requires the source balancer off too. Preflight DETECTS the state;
 * these helpers let the UI offer one-click DISABLE (before start) and RE-ENABLE (after
 * COMMITTED). They shell out to mongosh against a mongos URI via the hardened runner.
 *
 * All functions throw on failure (never silent):
 *  - {@link MongoshNotFoundError} when the mongosh binary is missing/not executable.
 *  - a plain Error (message normalised by mongosh.ts) for any other failure.
 */

export interface BalancerState {
  /** True when the connected cluster is sharded (mongos / populated config.shards). */
  sharded: boolean;
  /** Whether the balancer is on. null when sharded but the state could not be read. */
  enabled: boolean | null;
}

// One eval that reports topology + balancer state. On a replica set, sharded=false and
// enabled is null (the derived check skips). We prefer config.settings {_id:'balancer'}
// (stopped:true => disabled) and fall back to sh.getBalancerState(); enabled stays null
// if neither is readable so callers can render "unknown" rather than a wrong value.
const STATE_EVAL = `
(async function () {
  async function safe(fn, dflt) { try { return await fn(); } catch (e) { return dflt; } }
  var out = { sharded: false, enabled: null };
  out.sharded = await safe(function () {
    var h = db.hello();
    if (h && h.msg === 'isdbgrid') return true;
    return db.getSiblingDB('config').shards.countDocuments({}, { limit: 1 }) > 0;
  }, false);
  if (out.sharded) {
    out.enabled = await safe(function () {
      var s = db.getSiblingDB('config').settings.findOne({ _id: 'balancer' });
      if (s && typeof s.stopped === 'boolean') return !s.stopped;
      if (typeof sh !== 'undefined' && sh.getBalancerState) return !!sh.getBalancerState();
      return null;
    }, null);
  }
  return JSON.stringify(out);
})()
`;

/**
 * Read the current balancer state of a sharded cluster.
 * Returns `{ sharded: false, enabled: null }` for a replica set.
 * Throws {@link MongoshNotFoundError} when mongosh is missing, or an Error on query failure.
 */
export async function getBalancerState(uri: string): Promise<BalancerState> {
  const stdout = await runMongoshEval(uri, STATE_EVAL);
  let parsed: { sharded?: unknown; enabled?: unknown };
  try {
    parsed = JSON.parse(stdout) as { sharded?: unknown; enabled?: unknown };
  } catch {
    throw new Error("mongosh returned non-JSON balancer state");
  }
  return {
    sharded: parsed.sharded === true,
    enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : null,
  };
}

/**
 * Stop the balancer (`sh.stopBalancer()`). In-flight chunk migrations keep draining for
 * up to ~15 minutes after this returns; callers should surface that wait to the user.
 * Throws {@link MongoshNotFoundError} when mongosh is missing, or an Error on failure.
 */
export async function stopBalancer(uri: string): Promise<void> {
  await runBalancerCommand(uri, "sh.stopBalancer()");
}

/**
 * Re-enable the balancer (`sh.startBalancer()`), e.g. after the migration reaches COMMITTED.
 * Throws {@link MongoshNotFoundError} when mongosh is missing, or an Error on failure.
 */
export async function startBalancer(uri: string): Promise<void> {
  await runBalancerCommand(uri, "sh.startBalancer()");
}

// sh.stopBalancer/startBalancer return without throwing on success. We wrap the call so a
// non-existent-on-replica-set / unauthorized failure propagates as a clear Error (mongosh.ts
// already normalises the message and re-throws MongoshNotFoundError on a missing binary).
async function runBalancerCommand(uri: string, call: string): Promise<void> {
  try {
    await runMongoshEval(uri, call, { timeoutMs: 30000 });
  } catch (e) {
    if (isMongoshNotFound(e)) throw new MongoshNotFoundError();
    throw e instanceof Error ? e : new Error(String(e));
  }
}
