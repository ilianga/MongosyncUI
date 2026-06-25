import { getMigration } from "@/lib/db";
import { getLogDir, getInstanceLogDir } from "@/lib/paths";
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

  // Optional per-shard selector: when present, read from the instance's log subdir
  // (logs/<id>/<shard>/) instead of the migration root. getInstanceLogDir sanitises the
  // shard id, so it can't escape the migration's log directory.
  const shard = search.get("shard");
  const dir = shard ? getInstanceLogDir(id, shard) : getLogDir(id);
  const logFile = path.join(dir, fileName);
  if (!fs.existsSync(logFile)) return jsonOk({ lines: [] });

  let all: string[];
  try {
    all = fs.readFileSync(logFile, "utf-8").split("\n").filter(Boolean);
  } catch {
    return jsonOk({ lines: [] });
  }
  return jsonOk({ lines: all.slice(-lines) });
});
