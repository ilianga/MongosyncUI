import { checkCluster } from "@/lib/cluster-check";
import { buildConnectionString, type ConnectionConfig } from "@/lib/connection";
import { z } from "zod";
import { handle, jsonOk, jsonError, readJson, maskError } from "@/lib/api";

const bodySchema = z.object({
  uri: z.string().optional(),
  conn: z.unknown().optional(),
});

/**
 * Accepts EITHER { uri } (legacy) OR { conn } (structured ConnectionConfig). When a
 * structured conn is given we derive the URI and run the same checkCluster, so the
 * response shape is unchanged. Cert file paths inside conn.tls are expected to be
 * already-staged absolute paths (uploaded via /api/cluster-check/cert).
 *
 * Errors keep the `{ reachable: false, error }` shape the client branches on.
 */
export const POST = handle(async (request: Request) => {
  const body = await readJson(request, bodySchema);
  let uri: string | undefined = typeof body.uri === "string" ? body.uri : undefined;

  if (!uri && body.conn) {
    try {
      uri = buildConnectionString(body.conn as ConnectionConfig);
    } catch (e) {
      return jsonError(maskError(e), 400, { reachable: false });
    }
  }

  if (!uri) {
    return jsonError("uri or conn required", 400, { reachable: false });
  }
  return jsonOk(await checkCluster(uri));
});
