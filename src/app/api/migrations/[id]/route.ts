import { getMigration, deleteMigration } from "@/lib/db";
import { killMongosync } from "@/lib/process-manager";
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
  killMongosync(migration);
  deleteMigration(id);
  return jsonOk({ ok: true });
});
