import { NextRequest, NextResponse } from "next/server";
import { getMigration } from "@/lib/db";
import { retrySupervision } from "@/lib/supervisor";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getMigration(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    retrySupervision(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
