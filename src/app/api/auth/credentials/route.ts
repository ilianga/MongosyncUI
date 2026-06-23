import { initApp } from "@/lib/init";
import { checkCredentials, setCredentials, getAuthUsername } from "@/lib/auth";
import { z } from "zod";
import { handle, jsonOk, jsonError, readJson } from "@/lib/api";

const bodySchema = z.object({
  currentPassword: z.string(),
  username: z.string(),
  password: z.string(),
});

// Change the login credentials. The route is already gated by middleware (valid session
// required), and we additionally require the current password as a safety check.
export const POST = handle(async (request: Request) => {
  initApp();
  const { currentPassword, username, password } = await readJson(request, bodySchema);
  if (!checkCredentials(getAuthUsername(), currentPassword)) {
    return jsonError("Current password is incorrect", 403);
  }
  if (!username.trim() || !password) {
    return jsonError("Username and new password are required", 400);
  }
  setCredentials(username.trim(), password);
  return jsonOk({ ok: true });
});
