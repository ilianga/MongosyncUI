import path from "path";
import os from "os";
import fs from "fs";

export function getDataDir(): string {
  const dir = process.env.MONGOSYNC_UI_DIR || path.join(os.homedir(), ".mongosync-ui");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getConfigDir(): string {
  const dir = path.join(getDataDir(), "configs");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getLogDir(migrationId: string): string {
  const dir = path.join(getDataDir(), "logs", migrationId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
