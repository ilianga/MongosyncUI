import { NextRequest, NextResponse } from "next/server";
import { getMigration } from "@/lib/db";
import { getIndexBuilds } from "@/lib/index-builds";

// In-progress index builds read directly from the destination ($currentOp). mongosync's
// /progress only counts completed builds, so this fills the long build-phase gap.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const migration = getMigration(id);
  if (!migration) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const builds = await getIndexBuilds(migration.destUri);
  // null => couldn't query (mongosh missing / privileges); surface so the UI can hint.
  return NextResponse.json({ builds, available: builds !== null });
}
