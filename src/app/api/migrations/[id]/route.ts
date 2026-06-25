import { getMigration, deleteMigration } from "@/lib/db";
import { killMongosync, killShardedInstances } from "@/lib/process-manager";
import { handle, jsonOk, ApiError } from "@/lib/api";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const migration = getMigration(id);
  if (!migration) throw new ApiError("Not found", 404);
  return jsonOk(migration);
});

export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const migration = getMigration(id);
  if (!migration) throw new ApiError("Not found", 404);
  if (migration.sharded) {
    // Tear down all instance sessions; the instances rows cascade-delete with the migration.
    killShardedInstances(migration);
  } else {
    killMongosync(migration);
  }
  deleteMigration(id);
  return jsonOk({ ok: true });
});
