import { cn } from "@/lib/utils";
import type { SupervisionStatus } from "@/lib/types";

const STYLE: Record<SupervisionStatus, { label: string; cls: string }> = {
  running: { label: "supervised", cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
  restarting: { label: "restarting", cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  crash_looping: { label: "crash-looping", cls: "bg-red-500/15 text-red-600 dark:text-red-400" },
  stopped: { label: "stopped", cls: "bg-muted text-muted-foreground" },
  unsupervised: { label: "unsupervised", cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
};

export function SupervisionBadge({ status }: { status: SupervisionStatus }) {
  const s = STYLE[status] ?? STYLE.stopped;
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide", s.cls)}>
      {s.label}
    </span>
  );
}
