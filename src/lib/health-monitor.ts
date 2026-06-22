export type ProbeResult = "reachable" | "unreachable";

// Pure hung-detection policy. The caller owns the per-migration counter.
// A migration is "hung" only when the process/session is alive but /progress has
// been unreachable for `hungTicks` consecutive polls. Slow-but-reachable never trips this.
export function classifyTick(
  prevConsecutiveUnreachable: number,
  probe: ProbeResult,
  hungTicks: number
): { consecutive: number; action: "none" | "restart" } {
  if (probe === "reachable") return { consecutive: 0, action: "none" };
  const consecutive = prevConsecutiveUnreachable + 1;
  return { consecutive, action: consecutive >= hungTicks ? "restart" : "none" };
}
