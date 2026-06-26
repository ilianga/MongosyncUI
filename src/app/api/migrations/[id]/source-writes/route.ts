import { getMigration } from "@/lib/db";
import { getConnection, buildConnectionString } from "@/lib/connection";
import { checkSourceWrites, type SourceWriteCheck } from "@/lib/source-writes";
import { handle, jsonOk, ApiError } from "@/lib/api";

type Ctx = { params: Promise<{ id: string }> };

// GET — probe the source oplog for recent application writes (the headline cutover
// safety signal). checkSourceWrites never throws, but building the URI can, so guard it
// and return a 200 with {ok:false} rather than a 500 so the cockpit can render "Unknown".
export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const m = getMigration(id);
  if (!m) throw new ApiError("Not found", 404);

  let uri: string;
  try {
    uri = buildConnectionString(getConnection(m, "source"));
  } catch (err) {
    const result: SourceWriteCheck = {
      ok: false,
      writesDetected: null,
      recentCount: null,
      lastWriteAgoSec: null,
      windowSec: 10,
      error: err instanceof Error ? err.message : "Couldn't resolve source connection",
    };
    return jsonOk(result);
  }

  return jsonOk(await checkSourceWrites(uri));
});
