import { NextRequest, NextResponse } from "next/server";
import { initApp } from "@/lib/init";
import { checkCredentials } from "@/lib/auth";
import { createSession, SESSION_COOKIE } from "@/lib/session";

export async function POST(request: NextRequest) {
  initApp(); // ensures admin/admin is seeded on a fresh install
  const { username, password } = await request.json();
  if (typeof username !== "string" || typeof password !== "string" || !checkCredentials(username, password)) {
    return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });
  }
  const token = await createSession(username);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return res;
}
