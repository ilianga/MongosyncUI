import { z } from "zod";
import { buildConnectionString, type ConnectionConfig } from "@/lib/connection";
import { listNamespaces } from "@/lib/namespaces";
import { isMongoshNotFound } from "@/lib/mongosh";
import { handle, jsonOk, jsonError, readJson, maskError } from "@/lib/api";

const bodySchema = z.object({
  uri: z.string().optional(),
  conn: z.unknown().optional(),
});

/**
 * POST /api/cluster-check/namespaces
 *
 * Accepts EITHER { uri } OR { conn } (structured ConnectionConfig). Derives the URI via
 * buildConnectionString and lists user databases + their collections via mongosh.
 * System/internal databases and collections are excluded by listNamespaces.
 *
 * Resilient by design: missing/unreachable mongosh and query failures become a clear
 * `{ error }` (4xx) rather than a 500, so the explorer can show a friendly message and
 * the user can still fall back to manual entry.
 *
 * Returns `{ databases: [{ name, collections: [{ name, type }] }] }`.
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

  if (!uri) {
    return jsonError("uri or conn required", 400);
  }

  try {
    return jsonOk(await listNamespaces(uri));
  } catch (e) {
    if (isMongoshNotFound(e)) {
      return jsonError(
        "mongosh is not installed or not on PATH — install it to browse namespaces, or enter filters manually.",
        503
      );
    }
    // Auth/query/timeout failures: surface a masked, user-actionable message (4xx, not 500).
    return jsonError(maskError(e), 502);
  }
});
