"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StateBadge } from "./state-badge";
import { ActionButtons } from "./action-buttons";
import type { Migration } from "@/lib/types";
import Link from "next/link";

export function MigrationCard({ migration, onAction }: { migration: Migration; onAction?: () => void }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <Link href={`/migrations/${migration.id}`}>
            <CardTitle className="text-base hover:underline cursor-pointer">{migration.name}</CardTitle>
          </Link>
          <StateBadge state={migration.state} />
        </div>
        <p className="text-sm text-muted-foreground truncate">
          {migration.sourceUri} → {migration.destUri}
        </p>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>Port: {migration.port}</span>
            {migration.pid && <span>PID: {migration.pid}</span>}
          </div>
          <ActionButtons migration={migration} onAction={onAction} />
        </div>
      </CardContent>
    </Card>
  );
}
