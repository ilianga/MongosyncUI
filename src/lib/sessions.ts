import { listMsyncSessions, sessionName, instanceSessionName } from "./tmux";
import { getAllMigrations, getInstances } from "./db";

export interface SessionInfo {
  /** tmux session name, e.g. msync-<id> or msync-<id>-<shardId>. */
  name: string;
  /** Owning migration id, or null if no migration row matches (orphan). */
  migrationId: string | null;
  /** Migration name when linked. */
  migrationName: string | null;
  /** Shard id for a sharded instance session, else null. */
  shardId: string | null;
  /** Last-known migration state when linked. */
  state: string | null;
  /** True when no migration row owns this session (safe to kill permanently). */
  orphan: boolean;
}

/**
 * List every live `msync-*` tmux session and classify each as linked to a migration
 * or orphaned. Migration ids can contain "-", so we don't parse the name — instead we
 * build the set of session names each migration *should* own (single + per-shard) and
 * match against it (mirrors the supervisor's orphan sweep).
 */
export function listSessions(): SessionInfo[] {
  const migrations = getAllMigrations();
  const owned = new Map<string, { migrationId: string; migrationName: string; shardId: string | null; state: string }>();
  for (const m of migrations) {
    owned.set(sessionName(m.id), { migrationId: m.id, migrationName: m.name, shardId: null, state: m.state });
    if (m.sharded) {
      for (const inst of getInstances(m.id)) {
        owned.set(instanceSessionName(m.id, inst.shardId), {
          migrationId: m.id,
          migrationName: m.name,
          shardId: inst.shardId,
          state: m.state,
        });
      }
    }
  }

  return listMsyncSessions()
    .sort()
    .map((name) => {
      const o = owned.get(name);
      return {
        name,
        migrationId: o?.migrationId ?? null,
        migrationName: o?.migrationName ?? null,
        shardId: o?.shardId ?? null,
        state: o?.state ?? null,
        orphan: !o,
      };
    });
}

/** Guards that a name is a mongosync session before we kill it (never touch other tmux sessions). */
export function isMsyncSessionName(name: unknown): name is string {
  return typeof name === "string" && /^msync-/.test(name) && !name.includes(" ");
}
