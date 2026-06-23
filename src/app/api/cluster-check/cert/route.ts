import { saveStagedCert, type CertKind } from "@/lib/certs";
import { z } from "zod";
import { handle, jsonOk, readJson, ApiError } from "@/lib/api";

const bodySchema = z.object({
  token: z.string().min(1, "token required"),
  kind: z.enum(["ca", "certKey"], { message: "kind must be 'ca' or 'certKey'" }),
  pem: z.string().refine((s) => s.trim().length > 0, "pem required"),
});

/**
 * Stage an uploaded PEM cert before the migration exists. The form generates a nanoid
 * token, uploads CA / client-cert PEMs here, and submits the token with create so the
 * staged files get moved into the migration's permanent cert dir. Auth middleware gates /api/*.
 */
export const POST = handle(async (request: Request) => {
  const { token, kind, pem } = await readJson(request, bodySchema);
  try {
    const path = saveStagedCert(token, kind as CertKind, pem);
    return jsonOk({ path });
  } catch {
    // Filesystem failure writing the staged cert; keep details server-side.
    throw new ApiError("Failed to stage certificate", 500);
  }
});
