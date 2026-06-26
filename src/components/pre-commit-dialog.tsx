"use client";

import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import { useCallback, useState } from "react";
import type { ProgressResponse } from "@/lib/process-manager";
import type { SourceWriteCheck } from "@/lib/source-writes";
import { usePolling } from "@/hooks/use-polling";

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className={ok ? "text-primary" : "text-muted-foreground"}>
      {ok ? "✓" : "○"} {label}
    </li>
  );
}

// Three-state row for the source-writes safety gate (pass / fail / unknown).
function WriteCheckRow({ check }: { check: SourceWriteCheck | null }) {
  if (!check) {
    return <li className="text-muted-foreground">○ Source writes stopped (checking…)</li>;
  }
  if (check.ok === false) {
    return (
      <li className="text-amber-600 dark:text-amber-400">
        ! Source writes — unknown (couldn&apos;t read source oplog)
      </li>
    );
  }
  if (check.writesDetected === true) {
    const ago = check.lastWriteAgoSec != null ? `, last ${Math.round(check.lastWriteAgoSec)}s ago` : "";
    return (
      <li className="text-destructive">
        ✕ Source writes detected ({check.recentCount ?? "?"} in last {check.windowSec}s{ago})
      </li>
    );
  }
  return <li className="text-primary">✓ No source writes in last {check.windowSec}s</li>;
}

export function PreCommitDialog({
  open, onOpenChange, migrationId, progress, onCommitted,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  migrationId: string;
  progress: ProgressResponse | null;
  onCommitted: () => void;
}) {
  const [committing, setCommitting] = useState(false);

  // Poll the source-writes safety probe only while the dialog is open.
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
    enabled: open,
  });

  const p = progress?.progress;
  const stateOk = p?.state === "RUNNING";
  const canCommit = p?.canCommit === true;
  const lagOk = (p?.lagTimeSeconds ?? Infinity) <= 5;
  // Block commit when writes are actively detected; allow when none or unknown.
  const writesBlocking = writeCheck?.ok === true && writeCheck.writesDetected === true;
  const ready = stateOk && canCommit && lagOk && !writesBlocking;

  const commit = async () => {
    setCommitting(true);
    try {
      const res = await fetch(`/api/migrations/${migrationId}/commit`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).error || "Commit failed");
      toast.success("Commit started", { description: "Migration is finalizing (COMMITTING)." });
      onOpenChange(false);
      onCommitted();
    } catch (err) {
      toast.error("Commit failed", { description: (err as Error).message });
    } finally {
      setCommitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => onOpenChange(v)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Commit (cutover)</DialogTitle>
          <DialogDescription>
            Committing finalizes the migration. Confirm the cluster is ready before proceeding.
          </DialogDescription>
        </DialogHeader>
        <Alert variant="destructive">
          <AlertDescription>
            Stop all application writes to the source cluster before committing. Writing during commit can cause data loss.
          </AlertDescription>
        </Alert>
        <ul className="space-y-1 text-sm">
          <Check ok={stateOk} label="State is RUNNING" />
          <Check ok={canCommit} label="canCommit is true" />
          <Check ok={lagOk} label={`Lag is low (${p?.lagTimeSeconds ?? "—"}s)`} />
          <WriteCheckRow check={writeCheck ?? null} />
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!ready || committing} onClick={commit}>
            {committing ? "Committing..." : "Commit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
