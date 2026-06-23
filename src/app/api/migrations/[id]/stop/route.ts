import { NextRequest, NextResponse } from "next/server";
import { getMigration, updateMigration } from "@/lib/db";
import { killMongosync } from "@/lib/process-manager";

// Stop tears down the mongosync process to free resources but KEEPS the migration
// record. mongosync's resumable state stays on the destination, so /restart can pick
// up where it left off. (Contrast with DELETE, which removes the record entirely.)
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const migration = getMigration(id);
  if (!migration) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    killMongosync(migration);
    updateMigration(id, { desiredRunning: 0, stopped: 1, supervisionStatus: "stopped", pid: null });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
