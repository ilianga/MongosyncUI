"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";

export function ClusterUriField({
  id,
  label,
  value,
  error,
  register,
}: {
  id: string;
  label: string;
  value: string;
  error?: string;
  register: React.ComponentProps<typeof Input>;
}) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ status: "ok" | "warn" | "error"; msg: string } | null>(null);

  useEffect(() => { setResult(null); }, [value]);

  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      const res = await fetch("/api/cluster-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uri: value }),
      });
      const data = await res.json();
      if (!data.reachable) {
        setResult({ status: "error", msg: data.error || "Unreachable" });
      } else if (data.warning) {
        setResult({ status: "warn", msg: data.warning });
      } else {
        setResult({
          status: "ok",
          msg: data.version ? `Reachable — MongoDB ${data.version} (replica set)` : "Reachable",
        });
      }
    } catch (e) {
      setResult({ status: "error", msg: (e as Error).message });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <Input
          id={id}
          placeholder="mongodb://..."
          className="font-mono"
          {...register}
        />
        <Button type="button" variant="outline" disabled={testing || !value} onClick={test}>
          {testing ? "Testing..." : "Test"}
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {result && (
        result.status === "ok" ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-[#00684A] dark:text-[#71F6BA]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#00684A] dark:bg-[#71F6BA]" aria-hidden="true" />
            {result.msg}
          </span>
        ) : result.status === "warn" ? (
          <span className="inline-flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden="true" />
            {result.msg}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-xs text-destructive">
            <span className="h-1.5 w-1.5 rounded-full bg-destructive" aria-hidden="true" />
            {result.msg}
          </span>
        )
      )}
    </div>
  );
}
