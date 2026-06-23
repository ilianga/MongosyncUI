import { NextRequest, NextResponse } from "next/server";
import { initApp } from "@/lib/init";
import { checkCredentials, setCredentials, getAuthUsername } from "@/lib/auth";

// Change the login credentials. The route is already gated by middleware (valid session
// required), and we additionally require the current password as a safety check.
export async function POST(request: NextRequest) {
  initApp();
  const { currentPassword, username, password } = await request.json();
  if (typeof currentPassword !== "string" || !checkCredentials(getAuthUsername(), currentPassword)) {
    return NextResponse.json({ error: "Current password is incorrect" }, { status: 403 });
  }
  if (typeof username !== "string" || !username.trim() || typeof password !== "string" || !password) {
    return NextResponse.json({ error: "Username and new password are required" }, { status: 400 });
  }
  setCredentials(username.trim(), password);
  return NextResponse.json({ ok: true });
}
