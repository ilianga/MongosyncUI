import { SESSION_COOKIE } from "@/lib/session";
import { handle, jsonOk } from "@/lib/api";

export const POST = handle(async () => {
  const res = jsonOk({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return res;
});
