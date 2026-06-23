import path from "path";
import fs from "fs";
import { getDataDir } from "./paths";

export type CertKind = "ca" | "certKey";

/** Root dir for stored migration certs: ~/.mongosync-ui/certs/ */
function getCertsDir(): string {
  const dir = path.join(getDataDir(), "certs");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Staging area for uploads made BEFORE a migration row exists (Test button / create flow). */
function getStagingDir(token: string): string {
  // Guard against path traversal — tokens are nanoids, but be defensive.
  const safe = token.replace(/[^A-Za-z0-9_-]/g, "");
  const dir = path.join(getCertsDir(), "_staging", safe);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Persist an uploaded PEM into the staging area under the given token.
 * Returns the absolute on-disk path of the written file.
 */
export function saveStagedCert(token: string, kind: CertKind, pem: string): string {
  const dir = getStagingDir(token);
  const file = path.join(dir, `${kind}.pem`);
  fs.writeFileSync(file, pem, { mode: 0o600 });
  return file;
}

/**
 * Move any staged certs for `token` into the migration's permanent dir
 * (~/.mongosync-ui/certs/<migrationId>/), returning the final absolute paths.
 * Removes the staging dir afterwards. Safe to call with no staged files / no token.
 */
export function commitStagedCerts(
  token: string | undefined,
  migrationId: string
): { ca?: string; certKey?: string } {
  const result: { ca?: string; certKey?: string } = {};
  if (!token) return result;

  const stagingDir = getStagingDir(token);
  const destDir = path.join(getCertsDir(), migrationId);
  fs.mkdirSync(destDir, { recursive: true });

  for (const kind of ["ca", "certKey"] as const) {
    const src = path.join(stagingDir, `${kind}.pem`);
    if (fs.existsSync(src)) {
      const dest = path.join(destDir, `${kind}.pem`);
      fs.copyFileSync(src, dest);
      result[kind] = dest;
    }
  }

  // Best-effort cleanup of the staging dir.
  try {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }

  return result;
}
