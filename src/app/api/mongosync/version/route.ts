import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveMongosyncBin } from "@/lib/process-manager";
import { handle, jsonOk, jsonError } from "@/lib/api";

const execFileAsync = promisify(execFile);

export const GET = handle(async () => {
  const bin = resolveMongosyncBin();
  try {
    const { stdout } = await execFileAsync(bin, ["--version"], { timeout: 5000 });
    return jsonOk({ version: stdout.trim() });
  } catch {
    // Binary missing / not executable / timed out. Keep the message opaque so a
    // configured path isn't echoed back; details are in the server log via handle.
    return jsonError("mongosync binary not found or failed to run", 500);
  }
});
