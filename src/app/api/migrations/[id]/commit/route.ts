import { NextRequest, NextResponse } from "next/server";
import { getMigration, updateMigration } from "@/lib/db";
import { sendCommand, fetchProgress } from "@/lib/process-manager";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const migration = getMigration(id);
  if (!migration) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const progress = await fetchProgress(migration.port);
    if (!progress.progress?.canCommit) {
      return NextResponse.json(
        { error: "Cannot commit yet: canCommit is false. Wait for lag to reach ~0." },
        { status: 409 }
      );
    }
    await sendCommand(migration.port, "commit");
    updateMigration(id, { state: "COMMITTING" });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
