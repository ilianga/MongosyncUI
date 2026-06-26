"use client";

import { useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { usePolling } from "@/hooks/use-polling";
import { formatDuration } from "@/lib/format";
import { computeMigrationProgress } from "@/lib/progress";
import type { Metric } from "@/lib/types";
import type { ProgressResponse } from "@/lib/process-manager";
import type { SourceWriteCheck } from "@/lib/source-writes";

type LiveProgress = NonNullable<ProgressResponse["progress"]>;

type GateStatus = "pass" | "fail" | "warn" | "unknown";

function GateIcon({ status }: { status: GateStatus }) {
  const map: Record<GateStatus, { glyph: string; cls: string }> = {
    pass: { glyph: "✓", cls: "text-primary" },
    fail: { glyph: "✕", cls: "text-destructive" },
    warn: { glyph: "!", cls: "text-amber-600 dark:text-amber-400" },
    unknown: { glyph: "○", cls: "text-muted-foreground" },
  };
  const { glyph, cls } = map[status];
  return (
    <span className={`mt-0.5 w-4 shrink-0 text-center font-mono text-sm font-semibold ${cls}`} aria-hidden>
      {glyph}
    </span>
  );
}

function Gate({
  status,
  label,
  detail,
}: {
  status: GateStatus;
  label: string;
  detail?: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-2">
      <GateIcon status={status} />
      <div className="min-w-0">
        <p className="text-sm">{label}</p>
        {detail != null && <p className="text-xs text-muted-foreground">{detail}</p>}
      </div>
    </li>
  );
}

// Tiny inline bar sparkline of the last ~20 lag samples — taller bar = more lag.
function LagSparkline({ metrics }: { metrics: Metric[] }) {
  const points = metrics
    .slice(-20)
    .map((m) => m.lagTimeSeconds)
    .filter((v): v is number => v != null);
  if (points.length < 2) return null;
  const max = Math.max(...points, 1);
  return (
    <span className="ml-1 inline-flex h-4 items-end gap-px align-middle" aria-hidden>
      {points.map((v, i) => {
        const h = Math.max(1, Math.round((v / max) * 16));
        const hot = v > 5;
        return (
          <span
            key={i}
            className={`w-0.5 ${hot ? "bg-amber-500" : "bg-primary/60"}`}
            style={{ height: `${h}px` }}
          />
        );
      })}
    </span>
  );
}

function SourceWritesGate({ check }: { check: SourceWriteCheck | null }) {
  if (!check) {
    return <Gate status="unknown" label="Source writes stopped" detail="Checking…" />;
  }
  if (check.ok === false) {
    return (
      <Gate
        status="warn"
        label="Source writes stopped"
        detail={`Unknown — couldn't read source oplog${check.error ? ` (${check.error})` : ""}`}
      />
    );
  }
  if (check.writesDetected === true) {
    const ago = check.lastWriteAgoSec != null ? `, last write ${Math.round(check.lastWriteAgoSec)}s ago` : "";
    return (
      <Gate
        status="fail"
        label="Source writes stopped"
        detail={`Writes detected (${check.recentCount ?? "?"} in last ${check.windowSec}s${ago})`}
      />
    );
  }
  if (check.writesDetected === false) {
    return (
      <Gate
        status="pass"
        label="Source writes stopped"
        detail={`No writes in last ${check.windowSec}s`}
      />
    );
  }
  return <Gate status="unknown" label="Source writes stopped" detail="Unknown" />;
}

export function CutoverCockpit({
  migrationId,
  state,
  progress,
  metrics,
  onRequestCommit,
}: {
  migrationId: string;
  state: string;
  progress: LiveProgress | null | undefined;
  metrics: Metric[];
  onRequestCommit: () => void;
}) {
  // Only meaningful in a pre-cutover live state.
  const live = state === "RUNNING" || state === "PAUSED";

  const fetcher = useCallback(
    async (signal: AbortSignal): Promise<SourceWriteCheck> => {
      const res = await fetch(`/api/migrations/${migrationId}/source-writes`, { signal });
      if (!res.ok) throw new Error(`source-writes ${res.status}`);
      return (await res.json()) as SourceWriteCheck;
    },
    [migrationId],
  );
  const { data: writeCheck } = usePolling<SourceWriteCheck>(fetcher, {
    intervalMs: 5000,
    enabled: live,
  });

  if (!live) return null;

  const stateOk = state === "RUNNING";
  const canCommit = progress?.canCommit === true;
  const lag = progress?.lagTimeSeconds ?? null;
  const lagOk = lag != null && lag <= 5;

  const writesGo = writeCheck != null && writeCheck.ok && writeCheck.writesDetected === false;

  const prog = computeMigrationProgress(metrics, state);
  const eta = prog.etaSec;

  // The commit button is enabled when the core mongosync gates pass. Source-write safety is
  // surfaced loudly but not hard-blocking here — the PreCommitDialog is the final confirm.
  const ready = stateOk && canCommit && lagOk;

  return (
    <Card className="border-primary/30 bg-primary/[0.03]">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between gap-3 text-sm font-medium">
          <span>Cutover Cockpit</span>
          {ready ? (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              Ready to commit
            </span>
          ) : (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              Not yet ready
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="space-y-2">
          <Gate status={stateOk ? "pass" : "fail"} label="State is RUNNING" detail={`Currently ${state}`} />
          <Gate
            status={canCommit ? "pass" : "fail"}
            label="canCommit is true"
            detail={canCommit ? "mongosync reports cutover will succeed" : "mongosync not yet ready to commit"}
          />
          <Gate
            status={lagOk ? "pass" : lag != null ? "warn" : "unknown"}
            label="Lag is low"
            detail={
              <span className="inline-flex items-center">
                {lag != null ? `${Math.round(lag)}s` : "—"}
                <LagSparkline metrics={metrics} />
              </span>
            }
          />
          <SourceWritesGate check={writeCheck ?? null} />
          <Gate
            status={eta != null && eta <= 5 ? "pass" : "unknown"}
            label="ETA to commit-ready"
            detail={eta != null ? formatDuration(eta) : prog.detail || "—"}
          />
        </ul>

        {!writesGo && (
          <p className="text-xs text-muted-foreground">
            Stop application writes to the source before committing — writing during commit can cause data loss.
          </p>
        )}

        <Button onClick={onRequestCommit} disabled={!stateOk} className="w-full sm:w-auto">
          Commit (cutover)…
        </Button>
      </CardContent>
    </Card>
  );
}
