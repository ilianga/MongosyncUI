import { NextRequest, NextResponse } from "next/server";
import { getMigration, updateMigration } from "@/lib/db";
import { sendCommand } from "@/lib/process-manager";
import { buildStartBody } from "@/lib/config-generator";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const migration = getMigration(id);
  if (!migration) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    await sendCommand(migration.port, "start", buildStartBody(migration));
    updateMigration(id, { state: "RUNNING", desiredRunning: 1, supervisionStatus: "running" });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
