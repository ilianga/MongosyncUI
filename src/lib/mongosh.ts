import { execFile } from "node:child_process";
import { promisify } from "node:util";

// One hardened runner for every mongosh shell-out in the lib layer. Centralising it
// gives us: a single place to detect "mongosh not installed" (ENOENT) and turn it into
// a clearly-identifiable typed error, a consistent default timeout, trimmed stdout, and
// uniform error messages — instead of the duplicated execFile/promisify blocks that used
// to live in cluster-check / source-stats / index-builds / preflight.
//
// NOTE: we deliberately keep using `execFile` from `node:child_process` via promisify so
// that existing unit tests (which mock `node:child_process` and read the trailing callback)
// continue to exercise this code unchanged.
const execFileAsync = promisify(execFile);

/** Default mongosh eval timeout (ms). Callers can override per call. */
export const DEFAULT_MONGOSH_TIMEOUT_MS = 12000;

/**
 * Error thrown when the `mongosh` binary itself cannot be found/executed (ENOENT).
 * Distinct from query/auth failures so callers can decide whether to skip a feature
 * (mongosh optional) versus surface a real cluster error.
 */
export class MongoshNotFoundError extends Error {
  readonly code = "MONGOSH_NOT_FOUND" as const;
  constructor(message = "mongosh is not installed or not on PATH") {
    super(message);
    this.name = "MongoshNotFoundError";
  }
}

/** True if the given error means the mongosh binary could not be spawned. */
export function isMongoshNotFound(err: unknown): boolean {
  if (err instanceof MongoshNotFoundError) return true;
  const code = (err as { code?: unknown } | null)?.code;
  // ENOENT = binary missing; EACCES = present but not executable. Both mean "can't run mongosh".
  return code === "ENOENT" || code === "EACCES";
}

export interface RunMongoshOptions {
  /** Timeout in ms before the eval is killed (default DEFAULT_MONGOSH_TIMEOUT_MS). */
  timeoutMs?: number;
}

/**
 * Run a mongosh eval against a connection URI and return trimmed stdout.
 *
 * Throws:
 *  - {@link MongoshNotFoundError} when the mongosh binary is missing/not executable.
 *  - a plain Error (message normalised) for any other failure (auth, query, timeout).
 *
 * Callers that treat mongosh as optional should catch and inspect with
 * {@link isMongoshNotFound}; callers that need the data (cluster-check.hasSyncState)
 * let it propagate so the UI can fall back.
 */
export async function runMongoshEval(
  uri: string,
  script: string,
  options: RunMongoshOptions = {}
): Promise<string> {
  const timeout = options.timeoutMs ?? DEFAULT_MONGOSH_TIMEOUT_MS;
  try {
    const { stdout } = await execFileAsync(
      "mongosh",
      [uri, "--quiet", "--eval", script],
      { timeout }
    );
    return (stdout ?? "").trim();
  } catch (err) {
    if (isMongoshNotFound(err)) {
      throw new MongoshNotFoundError();
    }
    const e = err as { killed?: boolean; signal?: string; message?: string };
    if (e?.killed || e?.signal === "SIGTERM") {
      throw new Error(`mongosh timed out after ${timeout}ms`);
    }
    throw new Error(`mongosh eval failed: ${e?.message ?? String(err)}`);
  }
}

/**
 * Run a mongosh eval and JSON.parse the (trimmed) stdout into `T`.
 * Throws on a missing binary (MongoshNotFoundError), an eval failure, or unparseable output.
 */
export async function runMongoshJson<T>(
  uri: string,
  script: string,
  options: RunMongoshOptions = {}
): Promise<T> {
  const stdout = await runMongoshEval(uri, script, options);
  try {
    return JSON.parse(stdout) as T;
  } catch {
    throw new Error("mongosh returned non-JSON output");
  }
}

/**
 * Best-effort check that mongosh is installed and runnable. Returns false on a missing
 * binary; true otherwise. Never throws. Cheap eval (`print(1)`) with a short timeout.
 */
export async function isMongoshAvailable(): Promise<boolean> {
  try {
    await execFileAsync("mongosh", ["--quiet", "--eval", "print(1)"], { timeout: 5000 });
    return true;
  } catch (err) {
    return !isMongoshNotFound(err);
  }
}
