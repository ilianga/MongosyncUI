import type { MongosyncState } from "@/lib/types";

export interface StateStyle {
  dot: string;
  pill: string;
  pulse: boolean;
}

export const STATE_STYLE: Record<MongosyncState, StateStyle> = {
  RUNNING: {
    dot: "#00ED64",
    pill: "bg-[#E3FCF7] text-[#00684A] dark:bg-[#023430]/60 dark:text-[#71F6BA]",
    pulse: true,
  },
  PAUSED: {
    dot: "#FFC010",
    pill: "bg-[#FFEC9E] text-[#944F01] dark:bg-[#3D2A00]/60 dark:text-[#FFC010]",
    pulse: false,
  },
  COMMITTING: {
    dot: "#016BF8",
    pill: "bg-[#C3E7FE] text-[#083C90] dark:bg-[#0C2657]/60 dark:text-[#0498EC]",
    pulse: true,
  },
  COMMITTED: {
    dot: "#00A35C",
    pill: "bg-[#C0FAE6] text-[#00684A] dark:bg-[#023430]/80 dark:text-[#71F6BA]",
    pulse: false,
  },
  REVERSING: {
    dot: "#B45AF2",
    pill: "bg-[#F1D4FD] text-[#5E0C9E] dark:bg-[#2D0B59]/60 dark:text-[#B45AF2]",
    pulse: true,
  },
  IDLE: {
    dot: "#889397",
    pill: "bg-muted text-muted-foreground",
    pulse: false,
  },
};
