"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Stat } from "@/components/ui/stat";
import { formatBytes, formatDuration } from "@/lib/format";
import type { ProgressResponse } from "@/lib/process-manager";

export function ProgressPanel({ data }: { data: ProgressResponse | null }) {
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
  const total = p.collectionCopy?.estimatedTotalBytes ?? 0;
  const copyPct = total > 0 ? (copied / total) * 100 : 0;
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
        <CardContent className="space-y-2">
          <Progress value={idxPct} />
          <p className="font-mono text-xs text-muted-foreground">
            {idxBuilt} of {idxTotal} indexes built
          </p>
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
