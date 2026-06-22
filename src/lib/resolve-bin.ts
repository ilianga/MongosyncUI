import fs from "fs";
import path from "path";
import { getSetting } from "./db";

// Resolve the configured path to the actual mongosync executable. Tolerant of a
// common mistake: pointing at the bin/ DIRECTORY (or a path with a trailing
// slash) instead of the binary file — in that case we look for `mongosync`
// inside it. Falls back to "mongosync" on PATH when unset.
export function resolveMongosyncBin(): string {
  const configured = getSetting("mongosyncPath")?.trim();
  if (!configured) return "mongosync";
  try {
    if (configured.endsWith("/") || (fs.existsSync(configured) && fs.statSync(configured).isDirectory())) {
      return path.join(configured, "mongosync");
    }
  } catch {
    // stat failed — fall through and use the configured value as-is
  }
  return configured;
}

export function getMongosyncPath(): string {
  return resolveMongosyncBin();
}
