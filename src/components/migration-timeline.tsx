"use client";

import { useCallback } from "react";
import { usePolling } from "@/hooks/use-polling";

interface TimelineEvent {
  id: string;
  kind: string;
  label: string;
  message: string;
  createdAt: number;
}

// Compact "2m ago" style relative time from an epoch-ms timestamp.
function relativeTime(ms: number): string {
  const diff = Math.max(0, Date.now() - ms);
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function MigrationTimeline({ migrationId }: { migrationId: string }) {
  const fetcher = useCallback(
    async (signal: AbortSignal): Promise<TimelineEvent[]> => {
      const res = await fetch(`/api/migrations/${migrationId}/timeline`, { signal });
      if (!res.ok) throw new Error(`timeline ${res.status}`);
      const data = (await res.json()) as { events: TimelineEvent[] };
      return data.events;
    },
    [migrationId],
  );
  const { data, loading } = usePolling<TimelineEvent[]>(fetcher, { intervalMs: 10000 });

  if (loading && !data) {
    return <p className="text-sm text-muted-foreground">Loading timeline…</p>;
  }

  // Newest first.
  const events = (data ?? []).slice().sort((a, b) => b.createdAt - a.createdAt);

  if (events.length === 0) {
    return <p className="text-sm text-muted-foreground">No lifecycle events yet.</p>;
  }

  return (
    <ol className="space-y-0">
      {events.map((e, i) => (
        <li key={e.id} className="relative flex gap-3 pb-4 last:pb-0">
          {/* connector + node */}
          <div className="flex flex-col items-center">
            <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden />
            {i < events.length - 1 && <span className="mt-1 w-px flex-1 bg-border" aria-hidden />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-sm font-medium">{e.label}</p>
              <time className="shrink-0 font-mono text-xs text-muted-foreground" dateTime={new Date(e.createdAt).toISOString()}>
                {relativeTime(e.createdAt)}
              </time>
            </div>
            {e.message && <p className="text-xs text-muted-foreground break-words">{e.message}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
