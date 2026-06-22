"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { formatBytes, formatDuration } from "@/lib/format";
import type { ProgressResponse } from "@/lib/process-manager";

function Stat({ title, value, sub }: { title: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

export function ProgressPanel({ data }: { data: ProgressResponse | null }) {
  const p = data?.progress;
  if (!p) return <p className="text-sm text-muted-foreground">Live progress unavailable (process not reporting).</p>;

  const copied = p.collectionCopy?.estimatedCopiedBytes ?? 0;
  const total = p.collectionCopy?.estimatedTotalBytes ?? 0;
  const copyPct = total > 0 ? (copied / total) * 100 : 0;
  const idxBuilt = p.indexBuilding?.indexesBuilt ?? 0;
  const idxTotal = p.indexBuilding?.totalIndexesToBuild ?? 0;
  const idxPct = idxTotal > 0 ? (idxBuilt / idxTotal) * 100 : 0;

  return (
    <div className="space-y-4">
      {(p.warnings ?? []).map((w, i) => (
        <Alert key={i} variant="destructive"><AlertDescription>{w}</AlertDescription></Alert>
      ))}

      <div className="grid gap-4 md:grid-cols-4">
        <Stat title="Phase" value={p.info || p.state} />
        <Stat title="Lag Time" value={p.lagTimeSeconds != null ? `${p.lagTimeSeconds}s` : "—"} />
        <Stat title="Events Applied" value={(p.totalEventsApplied ?? 0).toLocaleString()} />
        <Stat
          title="CEA Catchup"
          value={p.estimatedSecondsToCEACatchup != null ? formatDuration(p.estimatedSecondsToCEACatchup) : "—"}
        />
        <Stat title="Oplog Window" value={p.estimatedOplogTimeRemaining || "—"} />
        <Stat title="Source Ping" value={p.source?.pingLatencyMs != null ? `${p.source.pingLatencyMs} ms` : "—"} />
        <Stat title="Dest Ping" value={p.destination?.pingLatencyMs != null ? `${p.destination.pingLatencyMs} ms` : "—"} />
        <Stat title="Can Commit" value={p.canCommit ? "Yes" : "No"} />
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Collection Copy</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Progress value={copyPct} />
          <p className="text-xs text-muted-foreground">
            {formatBytes(copied)} of {formatBytes(total)} ({copyPct.toFixed(1)}%)
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Index Building</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Progress value={idxPct} />
          <p className="text-xs text-muted-foreground">{idxBuilt} of {idxTotal} indexes built</p>
        </CardContent>
      </Card>

      {p.directionMapping && (
        <p className="text-xs text-muted-foreground">
          Direction: {p.directionMapping.Source} → {p.directionMapping.Destination}
        </p>
      )}
    </div>
  );
}
