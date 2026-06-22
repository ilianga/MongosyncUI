"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { MigrationCard } from "@/components/migration-card";
import Link from "next/link";
import type { Migration } from "@/lib/types";

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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Migrations</h1>
        <Link href="/migrations/new"><Button>New Migration</Button></Link>
      </div>
      {loading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : migrations.length === 0 ? (
        <p className="text-muted-foreground">No migrations yet. Create one to get started.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {migrations.map((m) => (
            <MigrationCard key={m.id} migration={m} onAction={fetchMigrations} />
          ))}
        </div>
      )}
    </div>
  );
}
