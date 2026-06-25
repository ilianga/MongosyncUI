import { spawnSync } from "node:child_process";

function tmux(args: string[]): { status: number | null; stdout: string; error?: Error } {
  const res = spawnSync("tmux", args, { encoding: "utf-8" });
  return { status: res.status, stdout: res.stdout ?? "", error: res.error };
}

export function hasTmux(): boolean {
  const res = tmux(["-V"]);
  return !res.error && res.status === 0;
}

export function sessionName(id: string): string {
  return `msync-${id}`;
}

/**
 * tmux session name for ONE instance of a sharded migration: `msync-<migrationId>-<shardId>`.
 * Still prefixed `msync-`, so listMsyncSessions() and the orphan sweep cover it too.
 */
export function instanceSessionName(migrationId: string, shardId: string): string {
  const safe = shardId.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `msync-${migrationId}-${safe}`;
}

export function sessionExists(name: string): boolean {
  return tmux(["has-session", "-t", name]).status === 0;
}

export function startSession(name: string, command: string): void {
  const res = tmux(["new-session", "-d", "-s", name, command]);
  if (res.status !== 0) {
    throw new Error(`tmux failed to start session ${name}${res.error ? `: ${res.error.message}` : ""}`);
  }
}

export function killSession(name: string): void {
  tmux(["kill-session", "-t", name]); // ignore status — absent session is fine
}

export function listMsyncSessions(): string[] {
  const res = tmux(["list-sessions", "-F", "#{session_name}"]);
  if (res.status !== 0) return [];
  return res.stdout
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.startsWith("msync-"));
}
