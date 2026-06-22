import { NextRequest, NextResponse } from "next/server";
import { getMigration } from "@/lib/db";
import { getLogDir } from "@/lib/paths";
import fs from "fs";
import path from "path";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getMigration(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const lines = Number(req.nextUrl.searchParams.get("lines") || "200");
  const which = req.nextUrl.searchParams.get("stream") === "stderr" ? "stderr.log" : "stdout.log";
  const logFile = path.join(getLogDir(id), which);
  if (!fs.existsSync(logFile)) return NextResponse.json({ lines: [] });

  const all = fs.readFileSync(logFile, "utf-8").split("\n").filter(Boolean);
  return NextResponse.json({ lines: all.slice(-lines) });
}
