import { getMigration, updateMigration } from "@/lib/db";
import { sendCommand } from "@/lib/process-manager";
import { handle, jsonOk, ApiError } from "@/lib/api";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const migration = getMigration(id);
  if (!migration) throw new ApiError("Not found", 404);
  await sendCommand(migration.port, "resume");
  updateMigration(id, { state: "RUNNING" });
  return jsonOk({ ok: true });
});
