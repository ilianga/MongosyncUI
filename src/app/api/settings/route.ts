import { getSetting, setSetting } from "@/lib/db";
import { z } from "zod";
import { handle, jsonOk, readJson } from "@/lib/api";

const KEYS = [
  "mongosyncPath",
  "pollInterval",
  "basePort",
  "defaultLoadLevel",
  "defaultVerbosity",
  "defaultVerification",
  "defaultDisableTelemetry",
  "supervisionMode",
  "backoffCapSec",
  "crashLoopMax",
  "crashLoopWindowSec",
  "hungTicks",
  // Notifications: outbound webhook + which event kinds to deliver. `notifyEvents` is a
  // comma-separated list of EventKind values (empty/unset = all kinds enabled).
  "notifyWebhookEnabled",
  "notifyWebhookUrl",
  "notifyEvents",
] as const;

// Accept any object; unknown keys and non-string values are ignored on write (same
// permissive behavior as before), but a non-object body is rejected as a 400.
const settingsSchema = z.record(z.string(), z.unknown());

export const GET = handle(async () => {
  const out: Record<string, string> = {};
  for (const k of KEYS) out[k] = getSetting(k) ?? "";
  return jsonOk(out);
});

export const PUT = handle(async (request: Request) => {
  const body = await readJson(request, settingsSchema);
  for (const [key, value] of Object.entries(body)) {
    if ((KEYS as readonly string[]).includes(key) && typeof value === "string") {
      setSetting(key, value);
    }
  }
  return jsonOk({ ok: true });
});
