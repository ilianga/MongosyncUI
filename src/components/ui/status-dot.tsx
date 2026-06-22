import { cn } from "@/lib/utils";
import { STATE_STYLE } from "@/lib/state-style";
import type { MongosyncState } from "@/lib/types";

export function StatusDot({
  state,
  className,
}: {
  state: MongosyncState;
  className?: string;
}) {
  const { dot, pulse } = STATE_STYLE[state];
  return (
    <span
      className={cn(
        "inline-block h-2 w-2 rounded-full shrink-0",
        pulse && "animate-pulse-dot",
        className
      )}
      style={{ color: dot, backgroundColor: dot }}
    />
  );
}
