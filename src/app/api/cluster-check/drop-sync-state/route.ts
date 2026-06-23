import { NextRequest, NextResponse } from "next/server";
import { dropSyncState } from "@/lib/cluster-check";

// Drops mongosync's resumable-state DB (__mdb_internal_mongosync) on the given cluster
// so a fresh sync can start. Invoked from the new-migration form after the user confirms.
export async function POST(request: NextRequest) {
  const { uri } = await request.json();
  if (typeof uri !== "string" || !uri) {
    return NextResponse.json({ ok: false, error: "uri required" }, { status: 400 });
  }
  try {
    await dropSyncState(uri);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
