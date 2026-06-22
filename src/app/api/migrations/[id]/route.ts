import { NextRequest, NextResponse } from "next/server";
import { getMigration, deleteMigration } from "@/lib/db";
import { killMongosync } from "@/lib/process-manager";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const migration = getMigration(id);
  if (!migration) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(migration);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const migration = getMigration(id);
  if (!migration) return NextResponse.json({ error: "Not found" }, { status: 404 });
  killMongosync(migration);
  deleteMigration(id);
  return NextResponse.json({ ok: true });
}
