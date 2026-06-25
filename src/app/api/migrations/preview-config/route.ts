import { z } from "zod";
import { handle, jsonOk, readJson } from "@/lib/api";
import { buildConnectionString, type ConnectionConfig } from "@/lib/connection";
import { buildConfigPreview } from "@/lib/config-generator";
import { maskUri } from "@/lib/format";
import type { StartConfig } from "@/lib/types";

// Same loose shape the create endpoint accepts: EITHER structured conns or legacy URI
// strings, plus an optional config blob. We only assert what we read directly.
const previewBodySchema = z.object({
  name: z.string().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  sourceConn: z.unknown().optional(),
  destConn: z.unknown().optional(),
  sourceUri: z.unknown().optional(),
  destUri: z.unknown().optional(),
});

/** Mask every mongodb URI password in a multi-line string (maskUri is single-match). */
function maskAll(text: string): string {
  return text.split("\n").map(maskUri).join("\n");
}

/** Mask any mongodb URI password inside an arbitrary JSON value (deep, immutable copy). */
function maskDeep(value: unknown): unknown {
  if (typeof value === "string") return maskUri(value);
  if (Array.isArray(value)) return value.map(maskDeep);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = maskDeep(v);
    return out;
  }
  return value;
}

/**
 * POST /api/migrations/preview-config
 * Build the YAML config + `/start` body exactly as create would, WITHOUT writing any file
 * or spawning anything. Passwords are masked in the returned yaml/startBody so the preview
 * never exposes plaintext secrets. The port shown is illustrative (auto-assigned on create).
 */
export const POST = handle(async (request: Request) => {
  const body = await readJson(request, previewBodySchema);

  const sourceConn: ConnectionConfig =
    (body.sourceConn as ConnectionConfig) ??
    (typeof body.sourceUri === "string" ? { raw: body.sourceUri } : {});
  const destConn: ConnectionConfig =
    (body.destConn as ConnectionConfig) ??
    (typeof body.destUri === "string" ? { raw: body.destUri } : {});

  const preview = buildConfigPreview({
    sourceUri: buildConnectionString(sourceConn),
    destUri: buildConnectionString(destConn),
    config: (body.config ?? {}) as StartConfig,
  });

  return jsonOk({
    yaml: maskAll(preview.yaml),
    startBody: maskDeep(preview.startBody) as Record<string, unknown>,
  });
});
