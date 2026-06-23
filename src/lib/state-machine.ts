import type { MongosyncState } from "./types";

export type ActionKind = "start" | "pause" | "resume" | "commit" | "reverse" | "stop" | "restart" | "delete";

const ACTIONS: Record<MongosyncState, ActionKind[]> = {
  IDLE: ["start", "delete"],
  RUNNING: ["pause", "commit", "stop", "delete"],
  PAUSED: ["resume", "stop", "delete"],
  COMMITTING: ["delete"],
  COMMITTED: ["reverse", "delete"],
  REVERSING: ["delete"],
};

// `stopped` migrations have no live process; the only moves are resume (restart) or delete,
// regardless of the last mongosync state we recorded.
export function availableActions(state: MongosyncState, stopped = false): ActionKind[] {
  if (stopped) return ["restart", "delete"];
  return ACTIONS[state] ?? ["delete"];
}

export const STATE_COLORS: Record<MongosyncState, string> = {
  IDLE: "bg-gray-100 text-gray-700 border-gray-300",
  RUNNING: "bg-blue-100 text-blue-700 border-blue-300",
  PAUSED: "bg-yellow-100 text-yellow-700 border-yellow-300",
  COMMITTING: "bg-purple-100 text-purple-700 border-purple-300",
  COMMITTED: "bg-green-100 text-green-700 border-green-300",
  REVERSING: "bg-orange-100 text-orange-700 border-orange-300",
};
