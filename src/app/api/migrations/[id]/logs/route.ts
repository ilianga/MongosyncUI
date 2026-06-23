import { NextRequest, NextResponse } from "next/server";
import { getMigration } from "@/lib/db";
import { getLogDir } from "@/lib/paths";
import fs from "fs";
import path from "path";

// Stream "mongosync" = the real structured mongosync.log (logPath output);
// "process" = the wrapper's captured stdout (mongosync.log already merges stderr
// via 2>&1, so there is no separate stderr stream worth exposing).
const STREAM_FILES: Record<string, string> = {
  mongosync: "mongosync.log",
  process: "stdout.log",
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getMigration(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const lines = Number(req.nextUrl.searchParams.get("lines") || "200");
  const streamParam = req.nextUrl.searchParams.get("stream") || "mongosync";
  const fileName = STREAM_FILES[streamParam] ?? STREAM_FILES.mongosync;

  const logFile = path.join(getLogDir(id), fileName);
  if (!fs.existsSync(logFile)) return NextResponse.json({ lines: [] });

  let all: string[];
  try {
    all = fs.readFileSync(logFile, "utf-8").split("\n").filter(Boolean);
  } catch {
    return NextResponse.json({ lines: [] });
  }
  return NextResponse.json({ lines: all.slice(-lines) });
}
