"use client";

import { Badge } from "@/components/ui/badge";
import { STATE_COLORS } from "@/lib/state-machine";
import type { MongosyncState } from "@/lib/types";

export function StateBadge({ state }: { state: MongosyncState }) {
  return (
    <Badge variant="outline" className={STATE_COLORS[state] || ""}>
      {state}
    </Badge>
  );
}
