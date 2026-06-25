import { z } from "zod";
import { handle, jsonOk, jsonError, readJson } from "@/lib/api";
import { killSession } from "@/lib/tmux";
import { isMsyncSessionName } from "@/lib/sessions";

const bodySchema = z.object({ name: z.string().min(1) });

// Kill a single mongosync tmux session by name. Guarded to `msync-*` names so we can
// never tear down unrelated tmux sessions. Killing a session whose migration is still
// desired-running will be respawned by the supervisor on the next tick — use the
// migration's Stop for those; this is primarily for orphaned sessions.
export const POST = handle(async (request: Request) => {
  const { name } = await readJson(request, bodySchema);
  if (!isMsyncSessionName(name)) return jsonError("Not a mongosync session", 400);
  killSession(name);
  return jsonOk({ ok: true });
});
