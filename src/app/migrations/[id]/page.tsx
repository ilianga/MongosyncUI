"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { StateBadge } from "@/components/state-badge";
import { SupervisionBadge } from "@/components/supervision-badge";
import { ActionButtons } from "@/components/action-buttons";
import { Button } from "@/components/ui/button";
import { ProgressPanel } from "@/components/progress-panel";
import { MigrationProgress } from "@/components/migration-progress";
import { VerificationPanel } from "@/components/verification-panel";
import { MetricsCharts } from "@/components/metrics-charts";
import { LogsPanel } from "@/components/logs-panel";
import { PreflightReportView } from "@/components/preflight-report";
import { PreCommitDialog } from "@/components/pre-commit-dialog";
import { ErrorBoundary } from "@/components/error-boundary";
import { usePolling } from "@/hooks/use-polling";
import { toast } from "sonner";
import type { Migration, Metric } from "@/lib/types";
import type { ProgressResponse } from "@/lib/process-manager";
import type { IndexBuild } from "@/lib/index-builds";
import { formatBytes, formatDuration } from "@/lib/format";

// Raised by the fetcher when the migration no longer exists (404), so the page
// can redirect home instead of showing a generic error.
class MigrationNotFoundError extends Error {
  constructor() {
    super("Migration not found");
    this.name = "MigrationNotFoundError";
  }
}

interface DetailData {
  migration: Migration;
  metrics: Metric[];
  progress: ProgressResponse | null;
  indexBuilds: IndexBuild[] | null;
}

async function fetchDetail(id: string, signal: AbortSignal): Promise<DetailData> {
  const [migRes, metRes, progRes] = await Promise.all([
    fetch(`/api/migrations/${id}`, { signal }),
    fetch(`/api/metrics/${id}`, { signal }),
    fetch(`/api/migrations/${id}/progress`, { signal }),
  ]);
  if (migRes.status === 404) throw new MigrationNotFoundError();
  if (!migRes.ok) throw new Error(`Failed to load migration (${migRes.status})`);

  const migration: Migration = await migRes.json();
  const metrics: Metric[] = metRes.ok ? await metRes.json() : [];
  const progress: ProgressResponse | null = progRes.ok ? await progRes.json() : null;

  // Only probe the destination for in-progress index builds while building is active
  // (mongosync reports more indexes to build than completed) — avoids a mongosh spawn
  // every tick the rest of the time.
  const idx = progress?.progress?.indexBuilding;
  const building = !!idx && (idx.totalIndexesToBuild ?? 0) > (idx.indexesBuilt ?? 0);
  let indexBuilds: IndexBuild[] | null = [];
  if (building) {
    try {
      const ib = await (await fetch(`/api/migrations/${id}/index-builds`, { signal })).json();
      indexBuilds = ib.available ? (ib.builds as IndexBuild[]) : null;
    } catch {
      indexBuilds = null;
    }
  }

  return { migration, metrics, progress, indexBuilds };
}

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
  const id = params.id;
  const [commitOpen, setCommitOpen] = useState(false);

  const fetcher = useCallback(
    (signal: AbortSignal) => fetchDetail(id, signal),
    [id],
  );
  const { data, error, loading, refresh } = usePolling<DetailData>(fetcher, {
    intervalMs: 5000,
  });

  const refreshNow = useCallback(() => {
    void refresh();
  }, [refresh]);

  // Redirect home when the migration was deleted/never existed.
  useEffect(() => {
    if (error instanceof MigrationNotFoundError) router.push("/");
  }, [error, router]);

  // Surface transient refresh failures once, keeping the last good render.
  const notifiedRef = useRef(false);
  useEffect(() => {
    if (error && !(error instanceof MigrationNotFoundError)) {
      if (!notifiedRef.current && data) {
        notifiedRef.current = true;
        toast.error("Couldn't refresh migration", { description: error.message });
      }
    } else {
      notifiedRef.current = false;
    }
  }, [error, data]);

  if (loading && !data) return <p className="text-muted-foreground">Loading...</p>;
  if (error instanceof MigrationNotFoundError || !data) {
    if (error && !(error instanceof MigrationNotFoundError)) {
      return (
        <div className="space-y-3">
          <p className="text-sm text-destructive">Couldn&apos;t load this migration.</p>
          <p className="text-xs text-muted-foreground">{error.message}</p>
          <Button variant="outline" onClick={refreshNow}>Retry</Button>
        </div>
      );
    }
    return <p className="text-muted-foreground">Migration not found.</p>;
  }

  const { migration, metrics, progress, indexBuilds } = data;
  const fetchData = refreshNow;

  const liveSource = progress?.progress?.directionMapping?.Source;
  const liveDest = progress?.progress?.directionMapping?.Destination;
  const sourceLabel = liveSource ?? migration.sourceUri;
  const destLabel = liveDest ?? migration.destUri;
  let preflightConfig: Record<string, unknown> = {};
  try { preflightConfig = JSON.parse(migration.config); } catch { /* keep {} */ }

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
                <StateBadge state={migration.state} withLegend />
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
        <ErrorBoundary label="Progress">
          <MigrationProgress
            metrics={metrics}
            state={migration.state}
            plannedTotalBytes={migration.plannedTotalBytes}
          />
        </ErrorBoundary>
        <ResourceStatsRow metric={metrics.length ? metrics[metrics.length - 1] : undefined} />
        <ErrorBoundary label="Progress details">
          <ProgressPanel
            data={progress}
            plannedTotalBytes={migration.plannedTotalBytes}
            indexBuilds={indexBuilds}
          />
        </ErrorBoundary>
        <ErrorBoundary label="Verification">
          <VerificationPanel verification={progress?.progress?.verification} />
        </ErrorBoundary>
        <section className="space-y-3">
          <SectionHeading>Preflight</SectionHeading>
          <PreflightReportView
            input={{ sourceUri: migration.sourceUri, destUri: migration.destUri, config: preflightConfig }}
          />
        </section>
        <section className="space-y-3">
          <SectionHeading>Metrics</SectionHeading>
          <ErrorBoundary label="Metrics charts">
            <MetricsCharts metrics={metrics} />
          </ErrorBoundary>
        </section>
        <section className="space-y-3">
          <SectionHeading>Logs</SectionHeading>
          <ErrorBoundary label="Logs">
            <LogsPanel migrationId={migration.id} />
          </ErrorBoundary>
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
