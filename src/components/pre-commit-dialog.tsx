"use client";
import type { ProgressResponse } from "@/lib/process-manager";
// STUB — replaced by the full pre-commit checklist in Task 8.
export function PreCommitDialog({
  open, onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  migrationId: string;
  progress: ProgressResponse | null;
  onCommitted: () => void;
}) {
  return null;
}
