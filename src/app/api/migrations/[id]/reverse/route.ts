import { getMigration, updateMigration } from "@/lib/db";
import { sendCommand } from "@/lib/process-manager";
import type { StartConfig } from "@/lib/types";
import { handle, jsonOk, ApiError } from "@/lib/api";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const migration = getMigration(id);
  if (!migration) throw new ApiError("Not found", 404);

  if (migration.state !== "COMMITTED") {
    throw new ApiError("Reverse is only available from the COMMITTED state.", 409);
  }
  const cfg = JSON.parse(migration.config) as StartConfig;
  if (!cfg.reversible) {
    throw new ApiError("This migration was not started with reversible: true.", 409);
  }

  await sendCommand(migration.port, "reverse");
  updateMigration(id, { state: "REVERSING" });
  return jsonOk({ ok: true });
});
