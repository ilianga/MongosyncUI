import { NextRequest, NextResponse } from "next/server";
import {
  getSavedConnection,
  updateSavedConnection,
  deleteSavedConnection,
} from "@/lib/db";
import { savedConnectionUpdateSchema } from "@/lib/schemas";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const conn = getSavedConnection(id);
  if (!conn) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(conn);
}

export async function PUT(request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = savedConnectionUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid connection" },
      { status: 400 }
    );
  }
  const updated = updateSavedConnection(id, parsed.data);
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  if (!getSavedConnection(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  deleteSavedConnection(id);
  return NextResponse.json({ ok: true });
}
