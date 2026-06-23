import { NextRequest, NextResponse } from "next/server";
import { saveStagedCert, type CertKind } from "@/lib/certs";

/**
 * Stage an uploaded PEM cert before the migration exists. The form generates a nanoid
 * token, uploads CA / client-cert PEMs here, and submits the token with create so the
 * staged files get moved into the migration's permanent cert dir. Auth middleware gates /api/*.
 */
export async function POST(request: NextRequest) {
  const { token, kind, pem } = await request.json();
  if (typeof token !== "string" || !token) {
    return NextResponse.json({ error: "token required" }, { status: 400 });
  }
  if (kind !== "ca" && kind !== "certKey") {
    return NextResponse.json({ error: "kind must be 'ca' or 'certKey'" }, { status: 400 });
  }
  if (typeof pem !== "string" || !pem.trim()) {
    return NextResponse.json({ error: "pem required" }, { status: 400 });
  }
  try {
    const path = saveStagedCert(token, kind as CertKind, pem);
    return NextResponse.json({ path });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
