import { getDb, getSetting } from "@/lib/db";
import { handle, jsonOk } from "@/lib/api";

/**
 * Lightweight liveness/readiness probe.
 *  - `dbOk`: a trivial DB read succeeded.
 *  - `mongosyncDetected`: a `mongosyncPath` setting is configured (cheap signal; we do
 *    not exec the binary here to keep the endpoint dependency-light).
 * Always returns 200 so monitors can read the booleans; it never throws.
 * (Still gated by auth middleware — that's acceptable.)
 */
export const GET = handle(async () => {
  let dbOk = false;
  let mongosyncDetected = false;
  try {
    // Trivial read against SQLite to confirm the DB is open and queryable.
    getDb().prepare("SELECT 1").get();
    dbOk = true;
    mongosyncDetected = Boolean(getSetting("mongosyncPath"));
  } catch {
    // Leave dbOk/mongosyncDetected false; never surface the underlying error.
  }
  return jsonOk({ ok: true, time: new Date().toISOString(), mongosyncDetected, dbOk });
});
