"use client";

import { Card } from "@/components/ui/card";
import { StateBadge } from "./state-badge";
import { SupervisionBadge } from "./supervision-badge";
import { ActionButtons } from "./action-buttons";
import { cn } from "@/lib/utils";
import { formatBytes, formatDuration, maskUri } from "@/lib/format";
import type { Migration } from "@/lib/types";
import Link from "next/link";

const ACTIVE_STATES = new Set(["RUNNING", "COMMITTING", "REVERSING"]);

// One compact labelled metric in the card's glimpse grid.
function Cell({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "ok" | "warn" }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-0.5 truncate font-mono text-sm",
          tone === "ok" && "text-[#00684A] dark:text-[#71F6BA]",
          tone === "warn" && "text-amber-600 dark:text-amber-400"
        )}
      >
        {value}
      </p>
    </div>
  );
}

export function MigrationCard({ migration, onAction }: { migration: Migration; onAction?: () => void }) {
  const isStopped = !!migration.stopped;
  const isActive = !isStopped && ACTIVE_STATES.has(migration.state);
  const live = migration.live ?? null;

  const pct =
    typeof migration.copyProgress === "number" ? Math.min(100, Math.max(0, migration.copyProgress)) : null;
  const showDeterminate = isActive && pct !== null && pct > 0;
  const lag = live?.lagTimeSeconds ?? null;
  const canCommit = live?.canCommit ?? false;

  return (
    <Card className="overflow-hidden p-5 transition-colors hover:border-primary/40">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <Link href={`/migrations/${migration.id}`} className="min-w-0">
          <h3 className="truncate text-lg font-semibold leading-tight hover:underline">{migration.name}</h3>
        </Link>
        <div className="flex shrink-0 items-center gap-1.5">
          <SupervisionBadge status={migration.supervisionStatus} />
          {isStopped ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 font-mono text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60" aria-hidden />
              Stopped
            </span>
          ) : (
            <StateBadge state={migration.state} />
          )}
        </div>
      </div>

      {/* Direction */}
      <div className="mt-1.5 flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
        <span className="truncate">{maskUri(migration.sourceUri)}</span>
        <span className="shrink-0 text-primary">→</span>
        <span className="truncate">{maskUri(migration.destUri)}</span>
      </div>

      {/* Progress */}
      <div className="mt-4 space-y-1.5">
        <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              "h-full rounded-full bg-primary transition-all",
              showDeterminate ? "" : isActive ? "w-full animate-pulse opacity-50" : "w-0 opacity-20"
            )}
            style={showDeterminate ? { width: `${pct}%` } : undefined}
          />
        </div>
        {showDeterminate && (
          <p className="flex justify-between font-mono text-[10px] text-muted-foreground">
            <span>
              {live
                ? `${formatBytes(live.estimatedCopiedBytes)} / ${formatBytes(migration.plannedTotalBytes ?? live.estimatedTotalBytes)}`
                : ""}
            </span>
            <span>{pct < 100 ? `${pct.toFixed(1)}% copied` : "copy complete"}</span>
          </p>
        )}
      </div>

      {/* Glimpse grid — only when we have a live snapshot */}
      {live && !isStopped && (
        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border/60 pt-4 sm:grid-cols-4">
          <Cell
            label="Lag"
            value={lag != null ? `${lag}s` : "—"}
            tone={lag != null ? (lag <= 5 ? "ok" : "warn") : undefined}
          />
          <Cell
            label="Can commit"
            value={canCommit ? "Yes" : "No"}
            tone={canCommit ? "ok" : "warn"}
          />
          <Cell label="Events" value={live.totalEventsApplied.toLocaleString()} />
          <Cell
            label="CEA ETA"
            value={live.estimatedSecondsToCEACatchup != null ? formatDuration(live.estimatedSecondsToCEACatchup) : "—"}
          />
          <Cell label="Src ping" value={live.sourcePingMs != null ? `${live.sourcePingMs} ms` : "—"} />
          <Cell label="Dst ping" value={live.destPingMs != null ? `${live.destPingMs} ms` : "—"} />
          {live.cpuPercent != null && (
            <Cell
              label="CPU"
              value={`${live.cpuPercent.toFixed(1)}%`}
              tone={live.cpuPercent >= 90 ? "warn" : undefined}
            />
          )}
          {live.rssBytes != null && <Cell label="Memory" value={formatBytes(live.rssBytes)} />}
          {live.uptimeSec != null && <Cell label="Uptime" value={formatDuration(live.uptimeSec)} />}
        </div>
      )}

      {/* Commit-blocked hint */}
      {isActive && live && !canCommit && (
        <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">
          Commit waits for change events to catch up{lag != null ? ` (lag ${lag}s)` : ""}. Stop writes on the source so lag reaches ~0.
        </p>
      )}

      {/* Footer */}
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-border/60 pt-4">
        <span className="font-mono text-xs text-muted-foreground">port {migration.port}</span>
        <ActionButtons migration={migration} onAction={onAction} canCommit={live ? canCommit : undefined} />
      </div>
    </Card>
  );
}
