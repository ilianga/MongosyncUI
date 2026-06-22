"use client";

import { cn } from "@/lib/utils";
import { STATE_STYLE } from "@/lib/state-style";
import { StatusDot } from "@/components/ui/status-dot";
import type { MongosyncState } from "@/lib/types";

export function StateBadge({ state }: { state: MongosyncState }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium font-mono uppercase tracking-wide",
        STATE_STYLE[state].pill
      )}
    >
      <StatusDot state={state} />
      {state}
    </span>
  );
}
