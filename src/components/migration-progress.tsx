"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/format";
import { computeMigrationProgress } from "@/lib/progress";
import type { Metric, MongosyncState } from "@/lib/types";

/**
 * Detail-page "Migration progress" panel: renders the Copy → Index build → Catch-up → Ready
 * pipeline with the active phase highlighted, a per-phase progress bar, and the current
 * phase's ETA. Computed client-side from the full metric series already fetched by the page.
 */
export function MigrationProgress({
  metrics,
  state,
  plannedTotalBytes,
}: {
  metrics: Metric[];
  state: MongosyncState | string;
  plannedTotalBytes?: number | null;
}) {
  const p = computeMigrationProgress(metrics, state, { plannedTotalBytes });

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Migration progress</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Pipeline track */}
        <ol className="flex items-center gap-2">
          {p.pipeline.map((step, i) => (
            <li key={step.phase} className="flex flex-1 items-center gap-2">
              <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
                <span
                  className={cn(
                    "flex size-6 items-center justify-center rounded-full border text-[10px] font-semibold",
                    step.state === "done" &&
                      "border-[#00684A] bg-[#00684A] text-white dark:border-[#71F6BA] dark:bg-[#71F6BA] dark:text-black",
                    step.state === "active" &&
                      "border-primary text-primary ring-2 ring-primary/30",
                    step.state === "pending" && "border-border text-muted-foreground"
                  )}
                  aria-hidden
                >
                  {step.state === "done" ? "✓" : i + 1}
                </span>
                <span
                  className={cn(
                    "truncate text-[10px] font-medium uppercase tracking-wide",
                    step.state === "active" ? "text-foreground" : "text-muted-foreground"
                  )}
                >
                  {step.label}
                </span>
              </div>
              {i < p.pipeline.length - 1 && (
                <span
                  className={cn(
                    "h-px w-4 shrink-0",
                    step.state === "done" ? "bg-[#00684A] dark:bg-[#71F6BA]" : "bg-border"
                  )}
                  aria-hidden
                />
              )}
            </li>
          ))}
        </ol>

        {/* Current phase summary */}
        <div className="space-y-2 rounded-md border border-border/60 p-4">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-medium">{p.phaseLabel}</p>
            <p className="font-mono text-xs text-muted-foreground">
              {p.etaSec != null ? `~${formatDuration(p.etaSec)} left` : p.detail}
            </p>
          </div>
          {p.phaseProgressPct != null && (
            <>
              <Progress value={p.phaseProgressPct} />
              <p className="flex justify-between font-mono text-[10px] text-muted-foreground">
                <span>{p.detail}</span>
                <span>{Math.round(p.phaseProgressPct)}%</span>
              </p>
            </>
          )}
          {p.phaseProgressPct == null && p.etaSec != null && (
            <p className="font-mono text-[10px] text-muted-foreground">{p.detail}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
