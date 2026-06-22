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
  delete: "Delete",
};

export function ActionButtons({
  migration,
  onAction,
  onConfirmCommit,
}: {
  migration: Migration;
  onAction?: () => void;
  onConfirmCommit?: () => void; // detail page wires this to the pre-commit checklist dialog
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
    if (action === "delete") {
      if (!confirm(`Delete migration "${migration.name}"? This kills its mongosync process.`)) return;
    }
    void run(action);
  };

  return (
    <div className="flex gap-2">
      {availableActions(migration.state).map((action) => (
        <Button
          key={action}
          size="sm"
          variant={action === "delete" ? "destructive" : action === "start" || action === "resume" ? "default" : "outline"}
          disabled={loading !== null}
          onClick={() => onClick(action)}
        >
          {loading === action ? "..." : LABELS[action]}
        </Button>
      ))}
    </div>
  );
}
