import { getConnections, createSavedConnection } from "@/lib/db";
import { savedConnectionSchema } from "@/lib/schemas";
import { handle, jsonOk, readJson } from "@/lib/api";

// GET — list saved connections. POST — create one. Auth middleware gates /api/*.
export const GET = handle(async () => {
  return jsonOk(getConnections());
});

export const POST = handle(async (request: Request) => {
  const data = await readJson(request, savedConnectionSchema);
  const created = createSavedConnection(data);
  return jsonOk(created, 201);
});
