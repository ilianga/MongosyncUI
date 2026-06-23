import { getMigration, updateMigration } from "@/lib/db";
import { sendCommand, fetchProgress } from "@/lib/process-manager";
import { handle, jsonOk, ApiError } from "@/lib/api";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const migration = getMigration(id);
  if (!migration) throw new ApiError("Not found", 404);

  const progress = await fetchProgress(migration.port);
  if (!progress.progress?.canCommit) {
    throw new ApiError("Cannot commit yet: canCommit is false. Wait for lag to reach ~0.", 409);
  }
  await sendCommand(migration.port, "commit");
  updateMigration(id, { state: "COMMITTING" });
  return jsonOk({ ok: true });
});
