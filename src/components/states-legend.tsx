"use client";

import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { StatusDot } from "@/components/ui/status-dot";
import { MONGOSYNC_STATES, type MongosyncState } from "@/lib/types";

/** One-line meaning per state, from the mongosync states reference. */
const STATE_MEANING: Record<MongosyncState, string> = {
  INITIALIZING: "Starting up; connecting to clusters. Not yet ready for /start.",
  IDLE: "Ready for a sync job to begin.",
  RUNNING: "Collection copy + change event application in progress.",
  PAUSED: "Sync paused; resumable via /resume.",
  COMMITTING: "Cutover started; finishing once lag reaches ~0.",
  COMMITTED: "Cutover complete; source write-blocked, destination writable.",
  REVERSING: "Swapping source/destination, then resuming in reverse.",
};

/**
 * A tiny "?" help trigger that, on hover/focus, shows a compact legend of every mongosync
 * state with a one-line meaning. Self-contained so it can sit next to a StateBadge without
 * any extra wiring.
 */
export function StatesLegend() {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          type="button"
          aria-label="mongosync state reference"
          className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-border text-[10px] font-medium leading-none text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          ?
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-sm flex-col items-stretch gap-1.5 p-3 text-left">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-background/80">
            mongosync states
          </p>
          <ul className="flex flex-col gap-1.5">
            {MONGOSYNC_STATES.map((state) => (
              <li key={state} className="flex items-start gap-2">
                <StatusDot state={state} className="mt-1" />
                <span className="leading-snug">
                  <span className="font-mono font-medium uppercase">{state}</span>
                  {" — "}
                  <span className="text-background/80">{STATE_MEANING[state]}</span>
                </span>
              </li>
            ))}
          </ul>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
