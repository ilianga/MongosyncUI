import { bootServiceStatus, installBootService, uninstallBootService } from "@/lib/os-unit";
import { hasTmux } from "@/lib/tmux";
import { z } from "zod";
import { handle, jsonOk, readJson, ApiError } from "@/lib/api";

export const GET = handle(async () => {
  return jsonOk({ ...bootServiceStatus(), tmux: hasTmux(), platform: process.platform });
});

const actionSchema = z.object({ action: z.enum(["install", "uninstall"]) });

export const POST = handle(async (req: Request) => {
  const { action } = await readJson(req, actionSchema);
  if (action === "install") return jsonOk(installBootService());
  if (action === "uninstall") return jsonOk(uninstallBootService());
  // Unreachable given the schema, but keeps the exhaustiveness explicit.
  throw new ApiError("Unknown action", 400);
});
