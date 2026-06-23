"use client";

import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { availableActions, type ActionKind } from "@/lib/state-machine";
import type { Migration } from "@/lib/types";
import { useRouter } from "next/navigation";
import { useState } from "react";

const LABELS: Record<ActionKind, string> = {
  start: "Start",
  pause: "Pause",
  resume: "Resume",
  commit: "Commit",
  reverse: "Reverse",
  stop: "Stop",
  restart: "Resume",
  delete: "Delete",
};

export function ActionButtons({
  migration,
  onAction,
  onConfirmCommit,
  canCommit,
}: {
  migration: Migration;
  onAction?: () => void;
  onConfirmCommit?: () => void; // detail page wires this to the pre-commit checklist dialog
  /** mongosync's current canCommit; when false the Commit button is disabled. */
  canCommit?: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState<ActionKind | null>(null);

  const run = async (action: ActionKind) => {
    setLoading(action);
    try {
      if (action === "delete") {
        const res = await fetch(`/api/migrations/${migration.id}`, { method: "DELETE" });
        if (!res.ok) throw new Error((await res.json()).error || "Delete failed");
      } else {
        const res = await fetch(`/api/migrations/${migration.id}/${action}`, { method: "POST" });
        if (!res.ok) throw new Error((await res.json()).error || `${action} failed`);
      }
      onAction?.();
      router.refresh();
    } catch (err) {
      toast.error("Action failed", { description: (err as Error).message });
    } finally {
      setLoading(null);
    }
  };

  const onClick = (action: ActionKind) => {
    if (action === "commit" && onConfirmCommit) return onConfirmCommit();
    if (action === "commit") {
      if (!confirm("Commit this migration? This step is hard to undo.")) return;
    }
    if (action === "reverse") {
      if (!confirm("Reverse this migration? This step is hard to undo.")) return;
    }
    if (action === "stop") {
      if (!confirm("Stop this migration? The mongosync process is torn down; you can resume it later.")) return;
    }
    if (action === "delete") {
      if (!confirm(`Delete migration "${migration.name}"? This kills its mongosync process and removes the record.`)) return;
    }
    void run(action);
  };

  // Commit is gated on mongosync reporting canCommit; when we know it's false, disable it.
  const isDisabled = (action: ActionKind) =>
    loading !== null || (action === "commit" && canCommit === false);
  const titleFor = (action: ActionKind) =>
    action === "commit" && canCommit === false
      ? "Commit unavailable: waiting for lag to reach ~0 (canCommit is false)"
      : undefined;

  return (
    <div className="flex flex-wrap gap-2">
      {availableActions(migration.state, !!migration.stopped).map((action) => (
        <Button
          key={action}
          size="sm"
          variant={action === "delete" ? "destructive" : action === "start" || action === "resume" || action === "restart" ? "default" : "outline"}
          disabled={isDisabled(action)}
          title={titleFor(action)}
          onClick={() => onClick(action)}
        >
          {loading === action ? "..." : LABELS[action]}
        </Button>
      ))}
    </div>
  );
}
