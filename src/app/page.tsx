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
          <div className="grid animate-fade-in gap-5 lg:grid-cols-2">
            {migrations.map((m) => (
              <MigrationCard key={m.id} migration={m} onAction={refreshNow} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
