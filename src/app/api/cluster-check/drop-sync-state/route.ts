import { dropSyncState } from "@/lib/cluster-check";
import { z } from "zod";
import { handle, jsonOk, jsonError, readJson, maskError } from "@/lib/api";

const bodySchema = z.object({ uri: z.string().min(1, "uri required") });

// Drops mongosync's resumable-state DB (__mdb_internal_mongosync) on the given cluster
// so a fresh sync can start. Invoked from the new-migration form after the user confirms.
export const POST = handle(async (request: Request) => {
  const { uri } = await readJson(request, bodySchema);
  try {
    await dropSyncState(uri);
    return jsonOk({ ok: true });
  } catch (e) {
    // maskError strips credentials from any mongosh error referencing the URI.
    return jsonError(maskError(e), 500, { ok: false });
  }
});
