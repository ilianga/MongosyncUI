import { getMigration, updateMigration } from "@/lib/db";
import { sendCommand } from "@/lib/process-manager";
import { buildStartBody } from "@/lib/config-generator";
import { handle, jsonOk, ApiError } from "@/lib/api";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const migration = getMigration(id);
  if (!migration) throw new ApiError("Not found", 404);
  await sendCommand(migration.port, "start", buildStartBody(migration));
  updateMigration(id, { state: "RUNNING", desiredRunning: 1, supervisionStatus: "running" });
  return jsonOk({ ok: true });
});
