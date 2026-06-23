import { getMigration } from "@/lib/db";
import { fetchProgress } from "@/lib/process-manager";
import { handle, jsonOk, jsonError, ApiError } from "@/lib/api";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const migration = getMigration(id);
  if (!migration) throw new ApiError("Not found", 404);
  try {
    const progress = await fetchProgress(migration.port);
    return jsonOk(progress);
  } catch {
    // The process may be down/initializing; surface 503 (transient) rather than 500,
    // and keep the error opaque so a URI never leaks into the response.
    return jsonError("mongosync is not reachable", 503);
  }
});
