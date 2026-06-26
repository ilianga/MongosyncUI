"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  MinusCircle,
  Loader2,
  Stethoscope,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ConnectionConfig } from "@/lib/connection";
import { toast } from "sonner";

type DoctorStatus = "pass" | "warn" | "fail" | "skip";
type DoctorRole = "source" | "destination";

interface DoctorCheck {
  id: string;
  label: string;
  status: DoctorStatus;
  detail: string;
  remediation?: string;
}

interface DoctorReport {
  reachable: boolean;
  version?: string;
  checks: DoctorCheck[];
  overall: "pass" | "warn" | "fail";
}

interface ConnectionDoctorProps {
  /** The connection to diagnose. When null the dialog is closed. */
  connection: { name: string; conn: ConnectionConfig } | null;
  onOpenChange: (open: boolean) => void;
}

const STATUS_META: Record<
  DoctorStatus,
  { Icon: typeof CheckCircle2; className: string }
> = {
  pass: { Icon: CheckCircle2, className: "text-emerald-600 dark:text-emerald-400" },
  warn: { Icon: AlertTriangle, className: "text-amber-600 dark:text-amber-400" },
  fail: { Icon: XCircle, className: "text-destructive" },
  skip: { Icon: MinusCircle, className: "text-muted-foreground" },
};

const OVERALL_META: Record<
  DoctorReport["overall"],
  { label: string; variant: "default" | "secondary" | "destructive"; className: string }
> = {
  pass: { label: "Healthy", variant: "secondary", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  warn: { label: "Warnings", variant: "secondary", className: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  fail: { label: "Problems", variant: "destructive", className: "" },
};

export function ConnectionDoctor({ connection, onOpenChange }: ConnectionDoctorProps) {
  const [role, setRole] = useState<DoctorRole>("source");
  const [report, setReport] = useState<DoctorReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = connection !== null;

  const run = useCallback(
    async (conn: ConnectionConfig, r: DoctorRole) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/cluster-doctor", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conn, role: r }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || `Diagnostics failed (${res.status})`);
        setReport(data as DoctorReport);
      } catch (e) {
        const msg = (e as Error).message;
        setError(msg);
        setReport(null);
        toast.error("Diagnostics failed", { description: msg });
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // Auto-run when the dialog opens or the role changes. The parent remounts this
  // component per connection (via `key`), so state starts fresh on each open.
  // Defer to a macrotask so the state updates inside run() don't fire synchronously
  // within the effect (which would trigger cascading renders).
  useEffect(() => {
    if (!connection) return;
    const t = setTimeout(() => void run(connection.conn, role), 0);
    return () => clearTimeout(t);
  }, [connection, role, run]);

  const overall = report ? OVERALL_META[report.overall] : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Stethoscope className="size-4" />
            Connection Doctor
          </DialogTitle>
          <DialogDescription>
            Diagnostics for {connection ? <span className="font-medium">{connection.name}</span> : "this connection"}.
            mongosync requires an authenticated, privileged user on a replica set.
          </DialogDescription>
        </DialogHeader>

        {/* Role toggle — the same cluster can be tested as either side of a sync. */}
        <div className="flex items-center justify-between gap-2">
          <div className="inline-flex rounded-lg border border-border p-0.5">
            {(["source", "destination"] as const).map((r) => (
              <Button
                key={r}
                type="button"
                size="sm"
                variant={role === r ? "secondary" : "ghost"}
                className="capitalize"
                onClick={() => setRole(r)}
                disabled={loading}
              >
                {r}
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {overall && (
              <Badge variant={overall.variant} className={overall.className}>
                {overall.label}
              </Badge>
            )}
            {report?.version && (
              <span className="text-xs text-muted-foreground">v{report.version}</span>
            )}
          </div>
        </div>

        <div className="max-h-[55vh] space-y-2 overflow-y-auto">
          {loading && (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Running diagnostics as {role}…
            </div>
          )}

          {!loading && error && (
            <div className="space-y-2 py-4">
              <p className="text-sm text-destructive">{error}</p>
              {connection && (
                <Button variant="outline" size="sm" onClick={() => void run(connection.conn, role)}>
                  Retry
                </Button>
              )}
            </div>
          )}

          {!loading && !error && report && report.checks.map((check) => {
            const { Icon, className } = STATUS_META[check.status];
            return (
              <div key={check.id} className="flex gap-2.5 rounded-md border border-border p-2.5">
                <Icon className={cn("mt-0.5 size-4 shrink-0", className)} aria-hidden />
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="text-sm font-medium">{check.label}</p>
                  <p className="text-xs text-muted-foreground">{check.detail}</p>
                  {check.remediation && (
                    <p className="text-xs text-muted-foreground/80 italic">{check.remediation}</p>
                  )}
                </div>
              </div>
            );
          })}

          {!loading && !error && report && report.checks.length === 0 && (
            <p className="py-4 text-sm text-muted-foreground">No checks were produced.</p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => connection && void run(connection.conn, role)}
            disabled={loading || !connection}
          >
            {loading ? "Running…" : "Re-run"}
          </Button>
          <Button onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
