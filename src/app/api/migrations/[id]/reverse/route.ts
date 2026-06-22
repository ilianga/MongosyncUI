import { NextRequest, NextResponse } from "next/server";
import { getMigration, updateMigration } from "@/lib/db";
import { sendCommand } from "@/lib/process-manager";
import type { StartConfig } from "@/lib/types";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const migration = getMigration(id);
  if (!migration) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (migration.state !== "COMMITTED") {
    return NextResponse.json(
      { error: "Reverse is only available from the COMMITTED state." },
      { status: 409 }
    );
  }
  const cfg = JSON.parse(migration.config) as StartConfig;
  if (!cfg.reversible) {
    return NextResponse.json(
      { error: "This migration was not started with reversible: true." },
      { status: 409 }
    );
  }

  try {
    await sendCommand(migration.port, "reverse");
    updateMigration(id, { state: "REVERSING" });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
