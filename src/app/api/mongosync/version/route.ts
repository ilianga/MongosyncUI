import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getSetting } from "@/lib/db";

const execFileAsync = promisify(execFile);

export async function GET() {
  const bin = getSetting("mongosyncPath") || "mongosync";
  try {
    const { stdout } = await execFileAsync(bin, ["--version"], { timeout: 5000 });
    return NextResponse.json({ version: stdout.trim() });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
