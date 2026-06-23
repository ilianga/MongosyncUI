import { NextResponse } from "next/server";
import type { ZodType } from "zod";
import { maskUri } from "@/lib/format";

/**
 * Shared helpers for the API layer. Goals:
 *  - Consistent error shape: every error is `{ error: string, ...extra }` with a proper status.
 *  - Safe body parsing: malformed JSON never throws out of a handler; it becomes a 400.
 *  - No leaks: `handle` logs the real error server-side and returns a generic 500 to the client,
 *    so stack traces / secrets never reach the wire.
 */

/** Build a consistent JSON error response: `{ error, ...extra }` with the given status. */
export function jsonError(
  message: string,
  status: number,
  extra?: Record<string, unknown>
): NextResponse {
  return NextResponse.json({ error: message, ...(extra ?? {}) }, { status });
}

/** Build a success JSON response. Mirrors `NextResponse.json` but reads intentionally. */
export function jsonOk<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

/**
 * A typed error carrying an HTTP status. `handle` recognizes it and turns it into a
 * `jsonError` with that status (instead of the generic 500). Use it for "expected"
 * failures discovered mid-handler (bad input, not found, conflict) where throwing reads
 * cleaner than early-returning.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly extra?: Record<string, unknown>;
  constructor(message: string, status: number, extra?: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.extra = extra;
  }
}

/**
 * Safely read + parse a JSON request body.
 *  - Empty body → `{}` (so `POST /pause` style "no options" calls just work).
 *  - Malformed JSON → throws `ApiError(400)` ("Invalid JSON body").
 *  - With a zod `schema` → validates; on failure throws `ApiError(400)` with the first
 *    readable issue message.
 * Always run inside `handle` so the thrown `ApiError` is converted to a response.
 */
export async function readJson<T = unknown>(
  req: Request,
  schema?: ZodType<T>
): Promise<T> {
  let raw: unknown;
  try {
    const text = await req.text();
    raw = text.trim() === "" ? {} : JSON.parse(text);
  } catch {
    throw new ApiError("Invalid JSON body", 400);
  }

  if (!schema) return raw as T;

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path?.length ? `${issue.path.join(".")}: ` : "";
    throw new ApiError(`${path}${issue?.message ?? "Invalid request body"}`, 400);
  }
  return parsed.data;
}

/**
 * Wrap a route handler so it never throws uncaught:
 *  - `ApiError` → its status + message (the "expected" path, e.g. 400/404/409).
 *  - Anything else → logged server-side via `console.error`, returns a generic
 *    `jsonError("Internal error", 500)`. Never leaks stack traces or secrets to the client.
 *
 * Usage: `export const POST = handle(async (req, ctx) => { ... })`.
 */
export function handle<Ctx>(
  fn: (req: Request, ctx: Ctx) => Promise<NextResponse> | NextResponse
): (req: Request, ctx: Ctx) => Promise<NextResponse> {
  return async (req: Request, ctx: Ctx): Promise<NextResponse> => {
    try {
      return await fn(req, ctx);
    } catch (err) {
      if (err instanceof ApiError) {
        return jsonError(err.message, err.status, err.extra);
      }
      // Log the real error (masking any URIs in the message) for the operator, but
      // return an opaque message to the client.
      console.error("[api] unhandled error:", maskError(err));
      return jsonError("Internal error", 500);
    }
  };
}

/**
 * Mask secrets in an error before it is surfaced (logs or, for expected errors, the
 * client). Runs `maskUri` over the message text so embedded `mongodb://user:pass@…`
 * connection strings never expose their password.
 */
export function maskError(err: unknown): string {
  const msg =
    err instanceof Error ? err.message : typeof err === "string" ? err : String(err);
  return maskUri(msg);
}
