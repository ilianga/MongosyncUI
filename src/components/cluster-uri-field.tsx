"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useState } from "react";

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
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

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
      setResult(
        data.reachable
          ? { ok: true, msg: data.version ? `Reachable — MongoDB ${data.version}` : "Reachable" }
          : { ok: false, msg: data.error || "Unreachable" }
      );
    } catch (e) {
      setResult({ ok: false, msg: (e as Error).message });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <Input id={id} placeholder="mongodb://..." {...register} />
        <Button type="button" variant="outline" disabled={testing || !value} onClick={test}>
          {testing ? "Testing..." : "Test"}
        </Button>
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
      {result && (
        <p className={`text-sm ${result.ok ? "text-green-600" : "text-red-500"}`}>{result.msg}</p>
      )}
    </div>
  );
}
