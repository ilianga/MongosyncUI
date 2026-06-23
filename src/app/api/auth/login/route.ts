import { initApp } from "@/lib/init";
import { checkCredentials } from "@/lib/auth";
import { createSession, SESSION_COOKIE } from "@/lib/session";
import { z } from "zod";
import { handle, jsonOk, jsonError, readJson } from "@/lib/api";

const bodySchema = z.object({
  username: z.string(),
  password: z.string(),
});

export const POST = handle(async (request: Request) => {
  initApp(); // ensures admin/admin is seeded on a fresh install
  const { username, password } = await readJson(request, bodySchema);
  if (!checkCredentials(username, password)) {
    return jsonError("Invalid username or password", 401);
  }
  const token = await createSession(username);
  const res = jsonOk({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return res;
});
