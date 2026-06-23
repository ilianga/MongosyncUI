"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Stat } from "@/components/ui/stat";
import { formatBytes, formatDuration } from "@/lib/format";
import type { ProgressResponse } from "@/lib/process-manager";
import type { IndexBuild } from "@/lib/index-builds";

export function ProgressPanel({
  data,
  plannedTotalBytes,
  indexBuilds,
}: {
  data: ProgressResponse | null;
  /** Stable source-computed total; preferred over mongosync's wobbling estimate. */
  plannedTotalBytes?: number | null;
  /** Live in-progress index builds from the destination; null = couldn't query. */
  indexBuilds?: IndexBuild[] | null;
}) {
  const p = data?.progress;

  if (!p) {
    return (
      <Card className="border-border/60">
        <CardContent className="py-6">
          <p className="text-sm text-muted-foreground">
            Live progress unavailable (process not reporting).
          </p>
        </CardContent>
      </Card>
    );
  }

  const copied = p.collectionCopy?.estimatedCopiedBytes ?? 0;
  const mongoTotal = p.collectionCopy?.estimatedTotalBytes ?? 0;
  // Prefer our stable source-computed total so the bar can't spike to ~100% and drop back.
  const total = plannedTotalBytes && plannedTotalBytes > 0 ? plannedTotalBytes : mongoTotal;
  const copyPct = total > 0 ? Math.min(100, (copied / total) * 100) : 0;
  const idxBuilt = p.indexBuilding?.indexesBuilt ?? 0;
  const idxTotal = p.indexBuilding?.totalIndexesToBuild ?? 0;
  const idxPct = idxTotal > 0 ? (idxBuilt / idxTotal) * 100 : 0;

  return (
    <div className="space-y-4">
      {(p.warnings ?? []).map((w, i) => (
        <Alert key={i} variant="destructive">
          <AlertDescription>{w}</AlertDescription>
        </Alert>
      ))}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Phase" value={p.info || p.state} />
        <Stat
          label="Lag Time"
          value={p.lagTimeSeconds != null ? `${p.lagTimeSeconds}s` : "—"}
          mono
        />
        <Stat
          label="Events Applied"
          value={(p.totalEventsApplied ?? 0).toLocaleString()}
          mono
        />
        <Stat
          label="CEA Catchup"
          value={
            p.estimatedSecondsToCEACatchup != null
              ? formatDuration(p.estimatedSecondsToCEACatchup)
              : "—"
          }
          mono
        />
        <Stat
          label="Oplog Window"
          value={p.estimatedOplogTimeRemaining || "—"}
          mono
        />
        <Stat
          label="Source Ping"
          value={
            p.source?.pingLatencyMs != null ? `${p.source.pingLatencyMs} ms` : "—"
          }
          mono
        />
        <Stat
          label="Dest Ping"
          value={
            p.destination?.pingLatencyMs != null
              ? `${p.destination.pingLatencyMs} ms`
              : "—"
          }
          mono
        />
        <Stat label="Can Commit" value={p.canCommit ? "Yes" : "No"} />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Collection Copy</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Progress value={copyPct} />
          <p className="font-mono text-xs text-muted-foreground">
            {formatBytes(copied)} of {formatBytes(total)} ({copyPct.toFixed(1)}%)
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Index Building</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Progress value={idxPct} />
            <p className="font-mono text-xs text-muted-foreground">
              {idxBuilt} of {idxTotal} indexes built (completed)
            </p>
          </div>

          {/* mongosync only counts COMPLETED builds; show what's actively building on the
              destination so the long build phase isn't a frozen "0 of N". */}
          {indexBuilds && indexBuilds.length > 0 && (
            <div className="space-y-2 border-t border-border/60 pt-3">
              <p className="text-xs font-medium text-muted-foreground">
                Building now ({indexBuilds.length})
              </p>
              {indexBuilds.map((b) => (
                <div key={b.ns} className="space-y-1">
                  <div className="flex items-center justify-between gap-2 font-mono text-xs">
                    <span className="truncate">{b.ns}</span>
                    <span className="shrink-0 text-muted-foreground">
                      {b.pct != null ? `${b.pct.toFixed(1)}%` : "building…"}
                    </span>
                  </div>
                  {b.pct != null && <Progress value={b.pct} />}
                  {b.total > 0 && (
                    <p className="font-mono text-[10px] text-muted-foreground">
                      scanned {b.done.toLocaleString()} / {b.total.toLocaleString()} docs
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {indexBuilds === null && (
            <p className="border-t border-border/60 pt-3 text-xs text-amber-600 dark:text-amber-400">
              Can&apos;t read in-progress builds from the destination. Grant the connecting user the{" "}
              <code>clusterMonitor</code> role (or root) so it has the <code>inprog</code> privilege.
            </p>
          )}
        </CardContent>
      </Card>

      {p.directionMapping && (
        <p className="font-mono text-xs text-muted-foreground">
          Direction: {p.directionMapping.Source}{" "}
          <span className="text-primary">→</span>{" "}
          {p.directionMapping.Destination}
        </p>
      )}
    </div>
  );
}
