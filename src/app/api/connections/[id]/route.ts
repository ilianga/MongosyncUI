import {
  getSavedConnection,
  updateSavedConnection,
  deleteSavedConnection,
} from "@/lib/db";
import { savedConnectionUpdateSchema } from "@/lib/schemas";
import { handle, jsonOk, readJson, ApiError } from "@/lib/api";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_request: Request, { params }: Ctx) => {
  const { id } = await params;
  const conn = getSavedConnection(id);
  if (!conn) throw new ApiError("Not found", 404);
  return jsonOk(conn);
});

export const PUT = handle(async (request: Request, { params }: Ctx) => {
  const { id } = await params;
  const data = await readJson(request, savedConnectionUpdateSchema);
  const updated = updateSavedConnection(id, data);
  if (!updated) throw new ApiError("Not found", 404);
  return jsonOk(updated);
});

export const DELETE = handle(async (_request: Request, { params }: Ctx) => {
  const { id } = await params;
  if (!getSavedConnection(id)) throw new ApiError("Not found", 404);
  deleteSavedConnection(id);
  return jsonOk({ ok: true });
});
