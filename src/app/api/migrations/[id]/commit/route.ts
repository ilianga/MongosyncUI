import { getMigration, updateMigration } from "@/lib/db";
import { sendCommand, fetchProgress } from "@/lib/process-manager";
import { broadcastCommand, allInstancesCanCommit } from "@/lib/sharded-lifecycle";
import { handle, jsonOk, ApiError } from "@/lib/api";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const migration = getMigration(id);
  if (!migration) throw new ApiError("Not found", 404);

  if (migration.sharded) {
    // Sharded commit gate: EVERY instance must report canCommit. Commit is blocking until
    // all instances commit — we broadcast /commit and move to COMMITTING; the poller's
    // state rollup advances the migration to COMMITTED only once every instance has.
    if (!(await allInstancesCanCommit(migration))) {
      throw new ApiError(
        "Cannot commit yet: not all shard instances report canCommit. Wait for lag to reach ~0 on every shard.",
        409
      );
    }
    await broadcastCommand(migration, "commit");
    updateMigration(id, { state: "COMMITTING" });
    return jsonOk({ ok: true });
  }

  const progress = await fetchProgress(migration.port);
  if (!progress.progress?.canCommit) {
    throw new ApiError("Cannot commit yet: canCommit is false. Wait for lag to reach ~0.", 409);
  }
  await sendCommand(migration.port, "commit");
  updateMigration(id, { state: "COMMITTING" });
  return jsonOk({ ok: true });
});
