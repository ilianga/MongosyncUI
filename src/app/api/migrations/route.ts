import { NextRequest, NextResponse } from "next/server";
import { getAllMigrations, createMigration, getMigration, updateMigration, deleteMigration, getSetting } from "@/lib/db";
import { spawnMongosync, sendCommand, killMongosync } from "@/lib/process-manager";
import { buildStartBody } from "@/lib/config-generator";
import { startPoller } from "@/lib/poller";
import { initApp } from "@/lib/init";

export async function GET() {
  initApp();
  return NextResponse.json(getAllMigrations());
}

export async function POST(request: NextRequest) {
  initApp();
  const { name, sourceUri, destUri, config } = await request.json();

  const basePort = Number(getSetting("basePort") || "27182");
  const used = new Set(getAllMigrations().map((m) => m.port));
  let port = basePort;
  while (used.has(port)) port++;

  // Apply settings-level defaults only where the form left a field unset.
  const merged = {
    verbosity: getSetting("defaultVerbosity") || undefined,
    loadLevel: getSetting("defaultLoadLevel") ? Number(getSetting("defaultLoadLevel")) : undefined,
    disableTelemetry: getSetting("defaultDisableTelemetry") === "true" || undefined,
    verificationEnabled:
      getSetting("defaultVerification") != null ? getSetting("defaultVerification") === "true" : undefined,
    ...(config ?? {}),
  };

  const migration = createMigration({ name, sourceUri, destUri, config: merged, port });

  try {
    spawnMongosync(migration);

    // Wait for the HTTP API to come up (up to 15s).
    let ready = false;
    for (let i = 0; i < 30; i++) {
      try {
        const res = await fetch(`http://localhost:${port}/api/v1/progress`);
        if (res.ok) { ready = true; break; }
      } catch { /* not ready */ }
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!ready) {
      const latest = getMigration(migration.id);
      if (latest) killMongosync(latest);
      deleteMigration(migration.id);
      return NextResponse.json({ error: "mongosync failed to start within 15s" }, { status: 500 });
    }

    await sendCommand(port, "start", buildStartBody(migration));
    updateMigration(migration.id, { state: "RUNNING" });
    startPoller();
    return NextResponse.json(getMigration(migration.id), { status: 201 });
  } catch (error) {
    const latest = getMigration(migration.id);
    if (latest) killMongosync(latest);
    deleteMigration(migration.id);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
