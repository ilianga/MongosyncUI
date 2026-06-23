import { getMigration } from "@/lib/db";
import { getIndexBuilds } from "@/lib/index-builds";
import { handle, jsonOk, ApiError } from "@/lib/api";

type Ctx = { params: Promise<{ id: string }> };

// In-progress index builds read directly from the destination ($currentOp). mongosync's
// /progress only counts completed builds, so this fills the long build-phase gap.
export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const migration = getMigration(id);
  if (!migration) throw new ApiError("Not found", 404);
  const builds = await getIndexBuilds(migration.destUri);
  // null => couldn't query (mongosh missing / privileges); surface so the UI can hint.
  return jsonOk({ builds, available: builds !== null });
});
