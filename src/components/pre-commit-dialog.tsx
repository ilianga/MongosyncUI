"use client";

import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import { useState } from "react";
import type { ProgressResponse } from "@/lib/process-manager";

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className={ok ? "text-primary" : "text-muted-foreground"}>
      {ok ? "✓" : "○"} {label}
    </li>
  );
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

  const p = progress?.progress;
  const stateOk = p?.state === "RUNNING";
  const canCommit = p?.canCommit === true;
  const lagOk = (p?.lagTimeSeconds ?? Infinity) <= 5;
  const ready = stateOk && canCommit && lagOk;

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
