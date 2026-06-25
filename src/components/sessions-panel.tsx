"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { usePolling } from "@/hooks/use-polling";
import { toast } from "sonner";

interface SessionInfo {
  name: string;
  migrationId: string | null;
  migrationName: string | null;
  shardId: string | null;
  state: string | null;
  orphan: boolean;
}
interface SessionsResp { tmux: boolean; sessions: SessionInfo[] }

export function SessionsPanel() {
  const fetcher = useCallback(async (signal: AbortSignal): Promise<SessionsResp> => {
    const res = await fetch("/api/sessions", { signal });
    if (!res.ok) throw new Error(`Failed to load sessions (${res.status})`);
    return res.json();
  }, []);
  const { data, error, loading, refresh } = usePolling<SessionsResp>(fetcher, { intervalMs: 5000 });
  const [killing, setKilling] = useState<string | null>(null);

  const kill = async (name: string) => {
    if (!confirm(`Kill tmux session "${name}"? This terminates that mongosync process.`)) return;
    setKilling(name);
    try {
      const res = await fetch("/api/sessions/kill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d?.error || "Kill failed");
      toast.success(`Killed ${name}`);
      void refresh();
    } catch (e) {
      toast.error("Couldn't kill session", { description: (e as Error).message });
    } finally {
      setKilling(null);
    }
  };

  const sessions = data?.sessions ?? [];
  const orphans = sessions.filter((s) => s.orphan);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Running mongosync sessions</CardTitle>
        <CardDescription>
          Live <code>msync-*</code> tmux sessions. Orphans (no migration record) can be killed here;
          for linked migrations use the migration&apos;s Stop (a supervised one will otherwise respawn).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && <p className="text-sm text-destructive">{error.message}</p>}
        {data && !data.tmux && (
          <p className="text-sm text-muted-foreground">tmux is not available — no supervised sessions.</p>
        )}
        {data?.tmux && sessions.length === 0 && (
          <p className="text-sm text-muted-foreground">{loading ? "Loading…" : "No live sessions."}</p>
        )}

        {sessions.map((s) => (
          <div key={s.name} className="flex items-center justify-between gap-3 rounded-md border border-border/60 p-3">
            <div className="min-w-0">
              <p className="truncate font-mono text-sm">{s.name}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {s.orphan ? (
                  <span className="text-amber-600 dark:text-amber-400">orphan — no migration record</span>
                ) : (
                  <>
                    <Link href={`/migrations/${s.migrationId}`} className="hover:underline">
                      {s.migrationName}
                    </Link>
                    {s.shardId && <> · shard <span className="font-mono">{s.shardId}</span></>}
                    {s.state && <> · {s.state}</>}
                  </>
                )}
              </p>
            </div>
            <div className="shrink-0">
              {s.orphan ? (
                <Button variant="destructive" size="sm" disabled={killing === s.name} onClick={() => kill(s.name)}>
                  {killing === s.name ? "Killing…" : "Kill"}
                </Button>
              ) : (
                <Button variant="outline" size="sm" disabled={killing === s.name} onClick={() => kill(s.name)}>
                  {killing === s.name ? "Killing…" : "Kill"}
                </Button>
              )}
            </div>
          </div>
        ))}

        {orphans.length > 1 && (
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              if (!confirm(`Kill all ${orphans.length} orphan sessions?`)) return;
              for (const o of orphans) {
                await fetch("/api/sessions/kill", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ name: o.name }),
                }).catch(() => {});
              }
              toast.success(`Killed ${orphans.length} orphan sessions`);
              void refresh();
            }}
          >
            Kill all {orphans.length} orphans
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
