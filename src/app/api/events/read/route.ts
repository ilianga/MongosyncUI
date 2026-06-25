import { markEventsRead, getUnreadEventCount } from "@/lib/db";
import { handle, jsonOk } from "@/lib/api";

// POST /api/events/read — mark all unread events as read. Body: {} (no options).
export const POST = handle(async () => {
  const marked = markEventsRead();
  return jsonOk({ marked, unread: getUnreadEventCount() });
});
