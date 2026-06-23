import { NextRequest, NextResponse } from "next/server";
import { checkCluster } from "@/lib/cluster-check";
import { buildConnectionString, type ConnectionConfig } from "@/lib/connection";

/**
 * Accepts EITHER { uri } (legacy) OR { conn } (structured ConnectionConfig). When a
 * structured conn is given we derive the URI and run the same checkCluster, so the
 * response shape is unchanged. Cert file paths inside conn.tls are expected to be
 * already-staged absolute paths (uploaded via /api/cluster-check/cert).
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  let uri: string | undefined = typeof body.uri === "string" ? body.uri : undefined;

  if (!uri && body.conn) {
    try {
      uri = buildConnectionString(body.conn as ConnectionConfig);
    } catch (e) {
      return NextResponse.json({ reachable: false, error: (e as Error).message }, { status: 400 });
    }
  }

  if (!uri) {
    return NextResponse.json({ reachable: false, error: "uri or conn required" }, { status: 400 });
  }
  return NextResponse.json(await checkCluster(uri));
}
