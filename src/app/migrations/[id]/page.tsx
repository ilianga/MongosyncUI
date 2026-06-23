"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { StateBadge } from "@/components/state-badge";
import { SupervisionBadge } from "@/components/supervision-badge";
import { ActionButtons } from "@/components/action-buttons";
import { Button } from "@/components/ui/button";
import { ProgressPanel } from "@/components/progress-panel";
import { VerificationPanel } from "@/components/verification-panel";
import { MetricsCharts } from "@/components/metrics-charts";
import { LogsPanel } from "@/components/logs-panel";
import { PreCommitDialog } from "@/components/pre-commit-dialog";
import type { Migration, Metric } from "@/lib/types";
import type { ProgressResponse } from "@/lib/process-manager";
import type { IndexBuild } from "@/lib/index-builds";
import { formatBytes, formatDuration } from "@/lib/format";

// Small section label used to separate the detail page's stacked panels.
function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</h2>
  );
}

// One labelled process-resource stat cell.
function ProcStat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-0.5 font-mono text-sm ${warn ? "text-amber-600 dark:text-amber-400" : ""}`}>{value}</p>
    </div>
  );
}

// Compact OS-level process resource stats from the latest polled metric.
function ResourceStatsRow({ metric }: { metric: Metric | undefined }) {
  if (!metric || (metric.cpuPercent == null && metric.rssBytes == null && metric.uptimeSec == null)) {
    return null;
  }
  return (
    <div className="grid grid-cols-3 gap-4 rounded-md border border-border/60 p-4">
      <ProcStat
        label="Process CPU"
        value={metric.cpuPercent != null ? `${metric.cpuPercent.toFixed(1)}%` : "—"}
        warn={metric.cpuPercent != null && metric.cpuPercent >= 90}
      />
      <ProcStat label="Process Memory" value={metric.rssBytes != null ? formatBytes(metric.rssBytes) : "—"} />
      <ProcStat label="Process Uptime" value={metric.uptimeSec != null ? formatDuration(metric.uptimeSec) : "—"} />
    </div>
  );
}

export default function MigrationDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [migration, setMigration] = useState<Migration | null>(null);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [progress, setProgress] = useState<ProgressResponse | null>(null);
  const [indexBuilds, setIndexBuilds] = useState<IndexBuild[] | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [commitOpen, setCommitOpen] = useState(false);

  const fetchData = async () => {
    try {
      const [migRes, metRes, progRes] = await Promise.all([
        fetch(`/api/migrations/${params.id}`),
        fetch(`/api/metrics/${params.id}`),
        fetch(`/api/migrations/${params.id}/progress`),
      ]);
      if (!migRes.ok) { router.push("/"); return; }
      setMigration(await migRes.json());
      setMetrics(await metRes.json());
      const prog: ProgressResponse | null = progRes.ok ? await progRes.json() : null;
      setProgress(prog);

      // Only probe the destination for in-progress index builds while building is active
      // (mongosync reports more indexes to build than completed) — avoids a mongosh spawn
      // every tick the rest of the time.
      const idx = prog?.progress?.indexBuilding;
      const building = !!idx && (idx.totalIndexesToBuild ?? 0) > (idx.indexesBuilt ?? 0);
      if (building) {
        try {
          const ib = await (await fetch(`/api/migrations/${params.id}/index-builds`)).json();
          setIndexBuilds(ib.available ? (ib.builds as IndexBuild[]) : null);
        } catch { setIndexBuilds(null); }
      } else {
        setIndexBuilds([]);
      }
    } catch { /* ignore */ } finally { setLoading(false); }
  };

  useEffect(() => {
    fetchData();
    const t = setInterval(fetchData, 5000);
    return () => clearInterval(t);
  }, [params.id]);

  if (loading) return <p className="text-muted-foreground">Loading...</p>;
  if (!migration) return <p className="text-muted-foreground">Migration not found.</p>;

  const liveSource = progress?.progress?.directionMapping?.Source;
  const liveDest = progress?.progress?.directionMapping?.Destination;
  const sourceLabel = liveSource ?? migration.sourceUri;
  const destLabel = liveDest ?? migration.destUri;

  return (
    <>
      {/* Sticky detail header */}
      <div className="sticky top-0 z-10 -mx-6 -mt-6 border-b border-border bg-background/80 px-6 py-3 backdrop-blur-md">
        <Link
          href="/"
          className="mb-1.5 inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="size-3.5"
            aria-hidden
          >
            <path d="m15 18-6-6 6-6" />
          </svg>
          Migrations
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-0.5">
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl font-semibold truncate">{migration.name}</h1>
              {migration.stopped ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 font-mono text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60" aria-hidden />
                  Stopped
                </span>
              ) : (
                <StateBadge state={migration.state} />
              )}
              <SupervisionBadge status={migration.supervisionStatus} />
            </div>
            <p className="font-mono text-xs text-muted-foreground truncate">
              {sourceLabel}
              <span className="mx-1.5 text-primary">→</span>
              {destLabel}
            </p>
          </div>
          <div className="shrink-0">
            <ActionButtons
              migration={migration}
              onAction={fetchData}
              onConfirmCommit={() => setCommitOpen(true)}
              canCommit={progress?.progress?.canCommit ?? undefined}
            />
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="space-y-6 animate-fade-in pt-6">
        {migration.supervisionStatus === "crash_looping" && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 space-y-2">
            <p className="text-sm font-medium text-destructive">
              mongosync is crash-looping (last exit code {migration.lastExitCode ?? "?"}, {migration.restartCount} restarts).
            </p>
            <p className="text-xs text-muted-foreground">
              Check the logs below for the cause. Once resolved, retry supervision.
            </p>
            <Button variant="outline" size="sm" onClick={async () => {
              await fetch(`/api/migrations/${migration.id}/retry`, { method: "POST" });
              router.refresh();
            }}>Retry</Button>
          </div>
        )}
        <ResourceStatsRow metric={metrics.length ? metrics[metrics.length - 1] : undefined} />
        <ProgressPanel
          data={progress}
          plannedTotalBytes={migration.plannedTotalBytes}
          indexBuilds={indexBuilds === undefined ? undefined : indexBuilds}
        />
        <VerificationPanel verification={progress?.progress?.verification} />
        <section className="space-y-3">
          <SectionHeading>Metrics</SectionHeading>
          <MetricsCharts metrics={metrics} />
        </section>
        <section className="space-y-3">
          <SectionHeading>Logs</SectionHeading>
          <LogsPanel migrationId={migration.id} />
        </section>
      </div>

      <PreCommitDialog
        open={commitOpen}
        onOpenChange={setCommitOpen}
        migrationId={migration.id}
        progress={progress}
        onCommitted={fetchData}
      />
    </>
  );
}
