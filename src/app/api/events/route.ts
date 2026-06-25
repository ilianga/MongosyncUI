import { getEvents, getUnreadEventCount } from "@/lib/db";
import { handle, jsonOk, ApiError } from "@/lib/api";

// GET /api/events?limit=50 — recent events (newest first) + unread count for the bell badge.
export const GET = handle(async (req: Request) => {
  const limitParam = new URL(req.url).searchParams.get("limit");
  let limit = 50;
  if (limitParam != null) {
    const n = Number(limitParam);
    if (!Number.isFinite(n) || n <= 0) throw new ApiError("`limit` must be a positive number", 400);
    limit = Math.min(200, Math.floor(n));
  }
  return jsonOk({ events: getEvents(limit), unread: getUnreadEventCount() });
});
