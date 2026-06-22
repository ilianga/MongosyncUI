import { NextRequest, NextResponse } from "next/server";
import { getMigration } from "@/lib/db";
import { fetchProgress } from "@/lib/process-manager";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const migration = getMigration(id);
  if (!migration) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const progress = await fetchProgress(migration.port);
    return NextResponse.json(progress);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 503 });
  }
}
