import { NextRequest, NextResponse } from "next/server";
import { getConnections, createSavedConnection } from "@/lib/db";
import { savedConnectionSchema } from "@/lib/schemas";

// GET — list saved connections. POST — create one. Auth middleware gates /api/*.
export async function GET() {
  return NextResponse.json(getConnections());
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = savedConnectionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid connection" },
      { status: 400 }
    );
  }
  const created = createSavedConnection(parsed.data);
  return NextResponse.json(created, { status: 201 });
}
