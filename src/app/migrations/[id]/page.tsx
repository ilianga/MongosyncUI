"use client";

import { useEffect, useState } from "react";
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

export default function MigrationDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [migration, setMigration] = useState<Migration | null>(null);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [progress, setProgress] = useState<ProgressResponse | null>(null);
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
      setProgress(progRes.ok ? await progRes.json() : null);
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
      <div className="sticky top-0 z-10 -mx-6 border-b border-border bg-background/80 px-6 py-3 backdrop-blur">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-0.5">
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl font-semibold truncate">{migration.name}</h1>
              <StateBadge state={migration.state} />
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
        <ProgressPanel data={progress} />
        <VerificationPanel verification={progress?.progress?.verification} />
        <MetricsCharts metrics={metrics} />
        <LogsPanel migrationId={migration.id} />
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
