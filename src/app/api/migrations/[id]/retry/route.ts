import { getMigration } from "@/lib/db";
import { retrySupervision } from "@/lib/supervisor";
import { handle, jsonOk, ApiError } from "@/lib/api";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  if (!getMigration(id)) throw new ApiError("Not found", 404);
  retrySupervision(id);
  return jsonOk({ ok: true });
});
