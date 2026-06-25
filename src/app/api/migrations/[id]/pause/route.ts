import { getMigration, updateMigration } from "@/lib/db";
import { sendCommand } from "@/lib/process-manager";
import { broadcastCommand } from "@/lib/sharded-lifecycle";
import { handle, jsonOk, ApiError } from "@/lib/api";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const migration = getMigration(id);
  if (!migration) throw new ApiError("Not found", 404);
  if (migration.sharded) {
    await broadcastCommand(migration, "pause");
  } else {
    await sendCommand(migration.port, "pause");
  }
  updateMigration(id, { state: "PAUSED" });
  return jsonOk({ ok: true });
});
