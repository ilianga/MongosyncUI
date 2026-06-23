import { NextRequest, NextResponse } from "next/server";
import { runPreflight } from "@/lib/preflight";
import { buildConnectionString, type ConnectionConfig } from "@/lib/connection";
import type { StartConfig } from "@/lib/types";

/**
 * Run the preflight readiness check for a (prospective) migration. Accepts EITHER
 * structured connections ({ sourceConn, destConn }) OR raw URIs ({ sourceUri, destUri }),
 * plus the StartConfig under `config`. Always returns a PreflightReport; individual
 * checks degrade to skip/warn rather than throwing, so failures here are limited to
 * malformed input.
 */
export async function POST(request: NextRequest) {
  let body: {
    sourceUri?: string;
    destUri?: string;
    sourceConn?: ConnectionConfig;
    destConn?: ConnectionConfig;
    config?: StartConfig;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  let sourceUri = body.sourceUri;
  let destUri = body.destUri;
  try {
    if (!sourceUri && body.sourceConn) sourceUri = buildConnectionString(body.sourceConn);
    if (!destUri && body.destConn) destUri = buildConnectionString(body.destConn);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  if (!sourceUri || !destUri) {
    return NextResponse.json({ error: "source and destination (uri or conn) required" }, { status: 400 });
  }

  const report = await runPreflight({ sourceUri, destUri, config: body.config });
  return NextResponse.json(report);
}
