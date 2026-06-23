import { getMigration, updateMigration } from "@/lib/db";
import { killMongosync } from "@/lib/process-manager";
import { handle, jsonOk, ApiError } from "@/lib/api";

type Ctx = { params: Promise<{ id: string }> };

// Stop tears down the mongosync process to free resources but KEEPS the migration
// record. mongosync's resumable state stays on the destination, so /restart can pick
// up where it left off. (Contrast with DELETE, which removes the record entirely.)
export const POST = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const migration = getMigration(id);
  if (!migration) throw new ApiError("Not found", 404);
  killMongosync(migration);
  updateMigration(id, { desiredRunning: 0, stopped: 1, supervisionStatus: "stopped", pid: null });
  return jsonOk({ ok: true });
});
