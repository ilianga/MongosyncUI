import { getMigration } from "@/lib/db";
import { getInstanceProgress } from "@/lib/sharded-lifecycle";
import { handle, jsonOk, ApiError } from "@/lib/api";

type Ctx = { params: Promise<{ id: string }> };

// Live per-shard breakdown for a sharded migration's detail page. Probes every instance
// port and returns one row per shard (state, port, progress, lag). Returns an empty array
// for a non-sharded migration so the caller can render nothing.
export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const migration = getMigration(id);
  if (!migration) throw new ApiError("Not found", 404);
  if (!migration.sharded) return jsonOk([]);
  const instances = await getInstanceProgress(migration);
  return jsonOk(instances);
});
