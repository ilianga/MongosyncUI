import { NextRequest, NextResponse } from "next/server";
import { bootServiceStatus, installBootService, uninstallBootService } from "@/lib/os-unit";
import { hasTmux } from "@/lib/tmux";

export async function GET() {
  return NextResponse.json({ ...bootServiceStatus(), tmux: hasTmux(), platform: process.platform });
}

export async function POST(req: NextRequest) {
  const { action } = (await req.json()) as { action?: string };
  try {
    if (action === "install") return NextResponse.json(installBootService());
    if (action === "uninstall") return NextResponse.json(uninstallBootService());
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
