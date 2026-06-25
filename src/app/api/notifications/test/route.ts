import { z } from "zod";
import { handle, jsonOk, readJson, ApiError } from "@/lib/api";
import { dispatchWebhook, webhookUrl, EVENT_KINDS } from "@/lib/notifications";

// POST /api/notifications/test — fire a test webhook. The URL may be supplied in the body
// (so the user can verify before saving settings); otherwise the saved setting is used.
const schema = z.object({ url: z.string().optional() });

export const POST = handle(async (request: Request) => {
  const { url } = await readJson(request, schema);
  const target = (url ?? "").trim() !== "" ? (url as string) : webhookUrl();
  if (target.trim() === "") {
    throw new ApiError("No webhook URL configured", 400);
  }

  const result = await dispatchWebhook(target, {
    kind: EVENT_KINDS.REACHED_CAN_COMMIT,
    migrationId: "test",
    migrationName: "Test migration",
    message: "This is a test notification from MongosyncUI.",
  });

  if (!result.ok) {
    throw new ApiError(`Webhook delivery failed: ${result.error ?? "unknown error"}`, 502);
  }
  return jsonOk({ ok: true, status: result.status });
});
