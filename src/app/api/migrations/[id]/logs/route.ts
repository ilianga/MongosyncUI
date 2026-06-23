import { getMigration } from "@/lib/db";
import { getLogDir } from "@/lib/paths";
import fs from "fs";
import path from "path";
import { handle, jsonOk, ApiError } from "@/lib/api";

type Ctx = { params: Promise<{ id: string }> };

// Stream "mongosync" = the real structured mongosync.log (logPath output);
// "process" = the wrapper's captured stdout (mongosync.log already merges stderr
// via 2>&1, so there is no separate stderr stream worth exposing).
const STREAM_FILES: Record<string, string> = {
  mongosync: "mongosync.log",
  process: "stdout.log",
};

export const GET = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  if (!getMigration(id)) throw new ApiError("Not found", 404);

  const search = new URL(req.url).searchParams;
  const parsedLines = Number(search.get("lines") || "200");
  const lines = Number.isFinite(parsedLines) && parsedLines > 0 ? Math.floor(parsedLines) : 200;
  const streamParam = search.get("stream") || "mongosync";
  const fileName = STREAM_FILES[streamParam] ?? STREAM_FILES.mongosync;

  const logFile = path.join(getLogDir(id), fileName);
  if (!fs.existsSync(logFile)) return jsonOk({ lines: [] });

  let all: string[];
  try {
    all = fs.readFileSync(logFile, "utf-8").split("\n").filter(Boolean);
  } catch {
    return jsonOk({ lines: [] });
  }
  return jsonOk({ lines: all.slice(-lines) });
});
