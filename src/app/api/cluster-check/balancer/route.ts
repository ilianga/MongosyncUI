import { z } from "zod";
import { buildConnectionString, type ConnectionConfig } from "@/lib/connection";
import { getBalancerState, stopBalancer, startBalancer } from "@/lib/balancer";
import { isMongoshNotFound } from "@/lib/mongosh";
import { handle, jsonOk, jsonError, readJson, maskError } from "@/lib/api";

const bodySchema = z.object({
  uri: z.string().optional(),
  conn: z.unknown().optional(),
  action: z.enum(["state", "disable", "enable"]),
});

/**
 * POST /api/cluster-check/balancer
 *
 * Semi-auto balancer control for sharded clusters. Accepts EITHER { uri } OR { conn }
 * (structured ConnectionConfig) plus an `action`:
 *  - "state"   → `{ sharded, enabled }`
 *  - "disable" → sh.stopBalancer(); `{ ok: true }`
 *  - "enable"  → sh.startBalancer(); `{ ok: true }`
 *
 * Resilient: a missing mongosh binary → 503, any query/auth failure → 502 (masked, never
 * a 500-with-stack). Secrets in error messages are stripped via maskError.
 */
export const POST = handle(async (request: Request) => {
  const body = await readJson(request, bodySchema);

  let uri: string | undefined = typeof body.uri === "string" ? body.uri : undefined;
  if (!uri && body.conn) {
    try {
      uri = buildConnectionString(body.conn as ConnectionConfig);
    } catch (e) {
      return jsonError(maskError(e), 400);
    }
  }
  if (!uri) return jsonError("uri or conn required", 400);

  try {
    if (body.action === "state") {
      return jsonOk(await getBalancerState(uri));
    }
    if (body.action === "disable") {
      await stopBalancer(uri);
    } else {
      await startBalancer(uri);
    }
    return jsonOk({ ok: true });
  } catch (e) {
    if (isMongoshNotFound(e)) {
      return jsonError(
        "mongosh is not installed or not on PATH — install it to control the balancer, or run sh.stopBalancer()/sh.startBalancer() manually.",
        503
      );
    }
    // Auth/query/timeout failures: masked, user-actionable message (502, not 500).
    return jsonError(maskError(e), 502);
  }
});
