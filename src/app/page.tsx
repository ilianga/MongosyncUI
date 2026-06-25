"use client";

import { useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { MigrationCard } from "@/components/migration-card";
import { Topbar } from "@/components/app-shell/topbar";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import Link from "next/link";
import { toast } from "sonner";
import { usePolling } from "@/hooks/use-polling";
import type { Migration } from "@/lib/types";

async function fetchMigrations(signal: AbortSignal): Promise<Migration[]> {
  const res = await fetch("/api/migrations", { signal });
  if (!res.ok) throw new Error(`Failed to load migrations (${res.status})`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

function SkeletonCard() {
  return (
    <div className="space-y-3 rounded-xl bg-card p-5 ring-1 ring-foreground/10">
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-2/5" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      <Skeleton className="h-3 w-3/4" />
      <Skeleton className="h-1.5 w-full rounded-full" />
      <div className="grid grid-cols-4 gap-3 pt-2">
        <Skeleton className="h-8" />
        <Skeleton className="h-8" />
        <Skeleton className="h-8" />
        <Skeleton className="h-8" />
      </div>
    </div>
  );
}

const ACTIVE_STATES = new Set(["RUNNING", "COMMITTING", "REVERSING"]);

// Split migrations into named multi-destination groups (preserving first-seen order) and
// the remaining ungrouped ones, which render exactly as before.
function partitionByGroup(migrations: Migration[]): {
  groups: { name: string; items: Migration[] }[];
  ungrouped: Migration[];
} {
  const groups: { name: string; items: Migration[] }[] = [];
  const index = new Map<string, { name: string; items: Migration[] }>();
  const ungrouped: Migration[] = [];
  for (const m of migrations) {
    const name = m.groupName?.trim();
    if (!name) {
      ungrouped.push(m);
      continue;
    }
    let g = index.get(name);
    if (!g) {
      g = { name, items: [] };
      index.set(name, g);
      groups.push(g);
    }
    g.items.push(m);
  }
  return { groups, ungrouped };
}

// Compact "N destinations · K running" summary for a group header.
function groupSummary(items: Migration[]): string {
  const running = items.filter((m) => !m.stopped && ACTIVE_STATES.has(m.state)).length;
  const dests = items.length;
  return `${dests} destination${dests === 1 ? "" : "s"} · ${running} running`;
}

const LeafIcon = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    className="h-6 w-6 text-[#00ED64]"
    aria-hidden="true"
  >
    <path d="M17 8C8 10 5.9 16.17 3.82 21.34L5.71 22l1-2.3A4.49 4.49 0 0 0 8 20C19 20 22 3 22 3c-1 2-8 2-8 8z" />
  </svg>
);

export default function DashboardPage() {
  const { data, error, loading, refresh } = usePolling<Migration[]>(fetchMigrations, {
    intervalMs: 5000,
  });
  const migrations = data ?? [];

  // Surface a transient fetch failure once, but keep showing the last good data.
  const notifiedRef = useRef(false);
  useEffect(() => {
    if (error && !notifiedRef.current) {
      notifiedRef.current = true;
      toast.error("Couldn't refresh migrations", { description: error.message });
    } else if (!error) {
      notifiedRef.current = false;
    }
  }, [error]);

  const refreshNow = useCallback(() => {
    void refresh();
  }, [refresh]);

  const count = migrations.length;

  return (
    <>
      <Topbar
        title="Migrations"
        subtitle={
          loading
            ? "Loading…"
            : count === 0
              ? "No active migrations"
              : `${count} migration${count === 1 ? "" : "s"}`
        }
        action={
          <Link href="/migrations/new">
            <Button>+ New Migration</Button>
          </Link>
        }
      />
      <div className="pt-4">
        {loading ? (
          <div className="grid gap-5 lg:grid-cols-2">
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : error && count === 0 ? (
          <EmptyState
            icon={LeafIcon}
            title="Couldn't load migrations"
            description={error.message}
            action={
              <Button variant="outline" onClick={refreshNow}>
                Retry
              </Button>
            }
          />
        ) : count === 0 ? (
          <EmptyState
            icon={LeafIcon}
            title="No migrations yet"
            description="Create your first cluster-to-cluster migration to start syncing."
            action={
              <Link href="/migrations/new">
                <Button>+ New Migration</Button>
              </Link>
            }
          />
        ) : (
          (() => {
            const { groups, ungrouped } = partitionByGroup(migrations);
            return (
              <div className="animate-fade-in space-y-8">
                {groups.map((g) => (
                  <section key={g.name} className="space-y-3">
                    <div className="flex items-baseline gap-2">
                      <h2 className="text-sm font-semibold text-foreground">{g.name}</h2>
                      <span className="font-mono text-xs text-muted-foreground">
                        {groupSummary(g.items)}
                      </span>
                    </div>
                    <div className="grid gap-5 rounded-xl border border-border/60 bg-muted/20 p-4 lg:grid-cols-2">
                      {g.items.map((m) => (
                        <MigrationCard key={m.id} migration={m} onAction={refreshNow} />
                      ))}
                    </div>
                  </section>
                ))}
                {ungrouped.length > 0 && (
                  <div className="grid gap-5 lg:grid-cols-2">
                    {ungrouped.map((m) => (
                      <MigrationCard key={m.id} migration={m} onAction={refreshNow} />
                    ))}
                  </div>
                )}
              </div>
            );
          })()
        )}
      </div>
    </>
  );
}
