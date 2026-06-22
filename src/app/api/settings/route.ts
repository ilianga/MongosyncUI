import { NextRequest, NextResponse } from "next/server";
import { getSetting, setSetting } from "@/lib/db";

const KEYS = [
  "mongosyncPath",
  "pollInterval",
  "basePort",
  "defaultLoadLevel",
  "defaultVerbosity",
  "defaultVerification",
  "defaultDisableTelemetry",
];

export async function GET() {
  const out: Record<string, string> = {};
  for (const k of KEYS) out[k] = getSetting(k) ?? "";
  return NextResponse.json(out);
}

export async function PUT(request: NextRequest) {
  const body = await request.json();
  for (const [key, value] of Object.entries(body)) {
    if (KEYS.includes(key) && typeof value === "string") setSetting(key, value);
  }
  return NextResponse.json({ ok: true });
}
