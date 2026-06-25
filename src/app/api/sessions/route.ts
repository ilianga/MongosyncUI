import { handle, jsonOk } from "@/lib/api";
import { listSessions } from "@/lib/sessions";
import { hasTmux } from "@/lib/tmux";

// Live mongosync tmux sessions, each classified as linked-to-a-migration or orphaned.
export const GET = handle(async () => {
  if (!hasTmux()) return jsonOk({ tmux: false, sessions: [] });
  return jsonOk({ tmux: true, sessions: listSessions() });
});
