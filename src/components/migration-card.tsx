"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StateBadge } from "./state-badge";
import { ActionButtons } from "./action-buttons";
import { cn } from "@/lib/utils";
import type { Migration } from "@/lib/types";
import Link from "next/link";

const ACTIVE_STATES = new Set(["RUNNING", "COMMITTING", "REVERSING"]);

export function MigrationCard({ migration, onAction }: { migration: Migration; onAction?: () => void }) {
  const isActive = ACTIVE_STATES.has(migration.state);

  return (
    <Card className="transition-colors hover:border-primary/40">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <Link href={`/migrations/${migration.id}`} className="min-w-0">
            <CardTitle className="text-base font-semibold hover:underline cursor-pointer truncate">
              {migration.name}
            </CardTitle>
          </Link>
          <StateBadge state={migration.state} />
        </div>
        <div className="flex items-center gap-1 font-mono text-sm text-muted-foreground min-w-0 overflow-hidden">
          <span className="truncate min-w-0">{migration.sourceUri}</span>
          <span className="text-primary shrink-0">→</span>
          <span className="truncate min-w-0">{migration.destUri}</span>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {/* Thin progress track — indeterminate for active states, empty otherwise */}
          <div className="relative h-1 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "h-full rounded-full bg-primary transition-all",
                isActive ? "w-full animate-pulse opacity-50" : "w-0 opacity-20"
              )}
            />
          </div>

          {/* Meta row: port + optional PID */}
          <div className="flex items-center gap-3 font-mono text-xs text-muted-foreground">
            <span>port {migration.port}</span>
            {migration.pid && <span>pid {migration.pid}</span>}
          </div>

          <ActionButtons migration={migration} onAction={onAction} />
        </div>
      </CardContent>
    </Card>
  );
}
