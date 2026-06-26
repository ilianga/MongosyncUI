import { z } from "zod";
import { handle, jsonOk, readJson, ApiError } from "@/lib/api";
import { buildConnectionString } from "@/lib/connection";
import { runConnectionDoctor } from "@/lib/connection-doctor";

// The body accepts either a structured ConnectionConfig (`conn`) or a raw `uri`, plus the
// role the cluster should be tested as. We keep the conn shape loose (passthrough) since
// buildConnectionString tolerates partial configs; validation lives there.
const bodySchema = z.object({
  conn: z.record(z.string(), z.unknown()).optional(),
  uri: z.string().optional(),
  role: z.enum(["source", "destination"]).optional(),
});

export const POST = handle(async (req) => {
  const body = await readJson(req, bodySchema);

  let uri: string | undefined = body.uri;
  if (!uri && body.conn) {
    try {
      uri = buildConnectionString(body.conn as Parameters<typeof buildConnectionString>[0]);
    } catch (e) {
      throw new ApiError(`Could not build connection string: ${(e as Error).message}`, 400);
    }
  }
  if (!uri || !uri.trim()) {
    throw new ApiError("Provide a connection (conn) or a uri to diagnose.", 400);
  }

  return jsonOk(await runConnectionDoctor(uri, body.role ?? "source"));
});
