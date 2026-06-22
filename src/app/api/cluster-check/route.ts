import { NextRequest, NextResponse } from "next/server";
import { checkCluster } from "@/lib/cluster-check";

export async function POST(request: NextRequest) {
  const { uri } = await request.json();
  if (typeof uri !== "string" || !uri) {
    return NextResponse.json({ reachable: false, error: "uri required" }, { status: 400 });
  }
  return NextResponse.json(await checkCluster(uri));
}
