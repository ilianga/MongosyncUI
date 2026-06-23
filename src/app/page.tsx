"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { MigrationCard } from "@/components/migration-card";
import { Topbar } from "@/components/app-shell/topbar";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import Link from "next/link";
import type { Migration } from "@/lib/types";

function SkeletonCard() {
  return (
    <div className="rounded-lg border border-border bg-card p-5 space-y-3">
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-2 w-full" />
      <Skeleton className="h-8 w-full" />
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
  const [migrations, setMigrations] = useState<Migration[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchMigrations = async () => {
    try {
      setMigrations(await (await fetch("/api/migrations")).json());
    } catch { /* ignore */ } finally { setLoading(false); }
  };

  useEffect(() => {
    fetchMigrations();
    const t = setInterval(fetchMigrations, 5000);
    return () => clearInterval(t);
  }, []);

  return (
    <>
      <Topbar
        title="Migrations"
        action={
          <Link href="/migrations/new">
            <Button>+ New Migration</Button>
          </Link>
        }
      />
      <div className="px-0 pt-6">
        {loading ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : migrations.length === 0 ? (
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
          <div className="grid gap-5 lg:grid-cols-2 animate-fade-in">
            {migrations.map((m) => (
              <MigrationCard key={m.id} migration={m} onAction={fetchMigrations} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
