"use client";

import { useEffect, useState } from "react";
import { StateBadge } from "./state-badge";
import { formatBytes } from "@/lib/format";
import type { InstanceProgress } from "@/lib/types";

// Per-shard breakdown for a sharded migration's detail page. Live-probes each instance via
// the /instances endpoint every 5s and shows one row per source shard: shardId, port,
// state, copy progress, and lag. Renders nothing for a non-sharded migration.
export function ShardBreakdown({ migrationId, sharded }: { migrationId: string; sharded: boolean }) {
  const [rows, setRows] = useState<InstanceProgress[] | null>(null);

  useEffect(() => {
    if (!sharded) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/migrations/${migrationId}/instances`);
        if (!res.ok) return;
        const data = (await res.json()) as InstanceProgress[];
        if (!cancelled) setRows(data);
      } catch {
        /* keep last good render */
      }
    };
    void load();
    const t = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [migrationId, sharded]);

  if (!sharded) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Per-shard instances
      </h2>
      {!rows ? (
        <p className="text-sm text-muted-foreground">Loading shard breakdown…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No instances.</p>
      ) : (
        <div className="overflow-hidden rounded-md border border-border/60">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/60 bg-muted/40 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 font-medium">Shard</th>
                <th className="px-3 py-2 font-medium">Port</th>
                <th className="px-3 py-2 font-medium">State</th>
                <th className="px-3 py-2 font-medium">Copy</th>
                <th className="px-3 py-2 font-medium">Lag</th>
                <th className="px-3 py-2 font-medium">Events</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.shardId} className="border-b border-border/40 last:border-0">
                  <td className="px-3 py-2 font-mono">{r.shardId}</td>
                  <td className="px-3 py-2 font-mono text-muted-foreground">{r.port}</td>
                  <td className="px-3 py-2">
                    {r.reachable && r.state ? (
                      <StateBadge state={r.state} />
                    ) : (
                      <span className="text-xs text-muted-foreground">unreachable</span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {r.estimatedTotalBytes > 0
                      ? `${formatBytes(r.estimatedCopiedBytes)} / ${formatBytes(r.estimatedTotalBytes)} (${r.copyProgress.toFixed(0)}%)`
                      : "—"}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {r.lagTimeSeconds != null ? `${r.lagTimeSeconds}s` : "—"}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{r.totalEventsApplied.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
