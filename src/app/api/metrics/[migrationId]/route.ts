import { getMetrics } from "@/lib/db";
import { handle, jsonOk, ApiError } from "@/lib/api";

type Ctx = { params: Promise<{ migrationId: string }> };

export const GET = handle(async (req: Request, { params }: Ctx) => {
  const { migrationId } = await params;
  const sinceParam = new URL(req.url).searchParams.get("since");
  let since: number | undefined;
  if (sinceParam != null) {
    const n = Number(sinceParam);
    if (!Number.isFinite(n)) throw new ApiError("`since` must be a number", 400);
    since = n;
  }
  return jsonOk(getMetrics(migrationId, since));
});
