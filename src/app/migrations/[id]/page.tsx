"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { StateBadge } from "@/components/state-badge";
import { ActionButtons } from "@/components/action-buttons";
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{migration.name}</h1>
            <StateBadge state={migration.state} />
          </div>
          <p className="text-sm text-muted-foreground">{migration.sourceUri} → {migration.destUri}</p>
        </div>
        <ActionButtons migration={migration} onAction={fetchData} onConfirmCommit={() => setCommitOpen(true)} />
      </div>

      <ProgressPanel data={progress} />
      <VerificationPanel verification={progress?.progress?.verification} />
      <MetricsCharts metrics={metrics} />
      <LogsPanel migrationId={migration.id} />

      <PreCommitDialog
        open={commitOpen}
        onOpenChange={setCommitOpen}
        migrationId={migration.id}
        progress={progress}
        onCommitted={fetchData}
      />
    </div>
  );
}
