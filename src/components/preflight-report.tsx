"use client";

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { ConnectionConfig } from "@/lib/connection";
import type { StartConfig } from "@/lib/types";
import type { PreflightCheck, PreflightReport, PreflightStatus } from "@/lib/preflight";

// Re-export the report types so consumers don't need a separate import.
export type { PreflightCheck, PreflightReport } from "@/lib/preflight";

type RunInput = {
  sourceUri?: string;
  destUri?: string;
  sourceConn?: ConnectionConfig;
  destConn?: ConnectionConfig;
  config?: StartConfig;
};

export interface PreflightReportProps {
  /** A precomputed report to render. If omitted, the component can run itself via `input`. */
  report?: PreflightReport | null;
  /** When `report` is not given, the inputs used to fetch /api/preflight (manual or auto). */
  input?: RunInput;
  /** Run the check automatically on mount / when `input` changes. */
  autoRun?: boolean;
  /** Notified whenever a freshly-run report arrives (so a parent can gate on overall). */
  onReport?: (report: PreflightReport) => void;
  className?: string;
}

const STATUS_META: Record<PreflightStatus, { icon: string; label: string; cls: string }> = {
  pass: { icon: "✓", label: "Pass", cls: "text-green-600 dark:text-green-400" },
  warn: { icon: "!", label: "Warn", cls: "text-amber-600 dark:text-amber-400" },
  fail: { icon: "✕", label: "Fail", cls: "text-destructive" },
  skip: { icon: "–", label: "Skip", cls: "text-muted-foreground" },
};

function CheckRow({ check }: { check: PreflightCheck }) {
  const meta = STATUS_META[check.status];
  return (
    <li className="flex gap-3 rounded-md border border-border bg-card px-3 py-2">
      <span
        aria-hidden
        className={cn(
          "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs font-bold",
          meta.cls
        )}
      >
        {meta.icon}
      </span>
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium text-foreground">{check.label}</p>
          <span className={cn("text-xs font-semibold uppercase tracking-wide", meta.cls)}>
            {meta.label}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">{check.detail}</p>
        {check.remediation && (
          <p className="text-xs text-foreground/80">
            <span className="font-medium">Fix: </span>
            {check.remediation}
          </p>
        )}
      </div>
    </li>
  );
}

const OVERALL_META: Record<PreflightReport["overall"], { label: string; cls: string }> = {
  pass: { label: "All checks passed", cls: "text-green-600 dark:text-green-400" },
  warn: { label: "Passed with warnings", cls: "text-amber-600 dark:text-amber-400" },
  fail: { label: "Blocking issues found", cls: "text-destructive" },
};

/**
 * Self-contained preflight report. Either pass a `report` to render, or pass `input`
 * (and optionally `autoRun`) and call the exposed Run button to fetch /api/preflight.
 * Reusable in the wizard and the migration detail page.
 */
export function PreflightReportView({
  report: reportProp,
  input,
  autoRun = false,
  onReport,
  className,
}: PreflightReportProps) {
  const [internal, setInternal] = useState<PreflightReport | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const report = reportProp ?? internal;

  const run = useCallback(async () => {
    if (!input) return;
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/preflight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Preflight failed");
      setInternal(data as PreflightReport);
      onReport?.(data as PreflightReport);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }, [input, onReport]);

  useEffect(() => {
    if (!autoRun || !input || reportProp) return;
    // Defer to a microtask so the state updates inside run() don't fire synchronously
    // within the effect (which would trigger cascading renders).
    const t = setTimeout(() => void run(), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRun]);

  return (
    <div className={cn("space-y-3", className)}>
      {input && !reportProp && (
        <button
          type="button"
          onClick={run}
          disabled={running}
          className="inline-flex h-8 items-center rounded-md border border-input bg-background px-3 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50"
        >
          {running ? "Running preflight…" : report ? "Re-run preflight" : "Run preflight"}
        </button>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {report && (
        <>
          <p className={cn("text-sm font-semibold", OVERALL_META[report.overall].cls)}>
            {OVERALL_META[report.overall].label}
          </p>
          <ul className="space-y-2">
            {report.checks.map((c) => (
              <CheckRow key={c.id} check={c} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export default PreflightReportView;
