import { runPreflight } from "@/lib/preflight";
import { buildConnectionString, type ConnectionConfig } from "@/lib/connection";
import type { StartConfig } from "@/lib/types";
import { handle, jsonOk, readJson, maskError, ApiError } from "@/lib/api";

type PreflightBody = {
  sourceUri?: string;
  destUri?: string;
  sourceConn?: ConnectionConfig;
  destConn?: ConnectionConfig;
  config?: StartConfig;
};

/**
 * Run the preflight readiness check for a (prospective) migration. Accepts EITHER
 * structured connections ({ sourceConn, destConn }) OR raw URIs ({ sourceUri, destUri }),
 * plus the StartConfig under `config`. Always returns a PreflightReport; individual
 * checks degrade to skip/warn rather than throwing, so failures here are limited to
 * malformed input.
 */
export const POST = handle(async (request: Request) => {
  const body = await readJson<PreflightBody>(request);

  let sourceUri = body.sourceUri;
  let destUri = body.destUri;
  try {
    if (!sourceUri && body.sourceConn) sourceUri = buildConnectionString(body.sourceConn);
    if (!destUri && body.destConn) destUri = buildConnectionString(body.destConn);
  } catch (e) {
    // maskError strips any embedded credentials before echoing the parse failure.
    throw new ApiError(maskError(e), 400);
  }

  if (!sourceUri || !destUri) {
    throw new ApiError("source and destination (uri or conn) required", 400);
  }

  const report = await runPreflight({ sourceUri, destUri, config: body.config });
  return jsonOk(report);
});
