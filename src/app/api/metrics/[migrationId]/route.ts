import { NextRequest, NextResponse } from "next/server";
import { getMetrics } from "@/lib/db";

export async function GET(req: NextRequest, { params }: { params: Promise<{ migrationId: string }> }) {
  const { migrationId } = await params;
  const since = req.nextUrl.searchParams.get("since");
  return NextResponse.json(getMetrics(migrationId, since ? Number(since) : undefined));
}
