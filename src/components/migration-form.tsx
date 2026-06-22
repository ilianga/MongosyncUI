"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { migrationFormSchema, formValuesToConfig, type MigrationFormValues } from "@/lib/schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ClusterUriField } from "./cluster-uri-field";
import { NamespaceFilterFields } from "./namespace-filter-fields";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function MigrationForm() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const form = useForm<MigrationFormValues>({
    resolver: zodResolver(migrationFormSchema) as any,
    defaultValues: {
      name: "", sourceUri: "", destUri: "",
      reversible: false, buildIndexes: "afterDataCopy", detectRandomId: true,
      preExistingDestinationData: false, verificationEnabled: true,
      loadLevel: 3, verbosity: "INFO",
      includeNamespaces: [], excludeNamespaces: [], shardingEntries: [],
    },
  });

  const reversible = form.watch("reversible");
  const rowsHaveRealFilter = (rows: { database?: string; databaseRegex?: string }[]) =>
    rows.some((r) => (r.database ?? "").trim() !== "" || (r.databaseRegex ?? "").trim() !== "");
  const hasFilters =
    rowsHaveRealFilter(form.watch("includeNamespaces")) || rowsHaveRealFilter(form.watch("excludeNamespaces"));

  const onSubmit = async (values: MigrationFormValues) => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/migrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: values.name,
          sourceUri: values.sourceUri,
          destUri: values.destUri,
          config: formValuesToConfig(values),
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to create migration");
      router.push("/");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 max-w-2xl">
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

      <div className="space-y-2">
        <Label htmlFor="name">Migration Name</Label>
        <Input id="name" {...form.register("name")} placeholder="My Migration" />
        {form.formState.errors.name && (
          <p className="text-sm text-red-500">{form.formState.errors.name.message}</p>
        )}
      </div>

      <ClusterUriField
        id="sourceUri" label="Source Cluster URI" value={form.watch("sourceUri")}
        error={form.formState.errors.sourceUri?.message} register={form.register("sourceUri")}
      />
      <ClusterUriField
        id="destUri" label="Destination Cluster URI" value={form.watch("destUri")}
        error={form.formState.errors.destUri?.message} register={form.register("destUri")}
      />

      <div className="space-y-4 rounded-md border p-4">
        <h3 className="font-medium">Sync Options</h3>
        <div className="flex items-center justify-between">
          <Label htmlFor="reversible">Reversible</Label>
          <Switch id="reversible" checked={reversible}
            onCheckedChange={(v) => form.setValue("reversible", v)} />
        </div>
        {reversible && hasFilters && (
          <Alert variant="destructive">
            <AlertDescription>
              Reverse sync is incompatible with namespace filtering. Remove filters or disable reversible.
            </AlertDescription>
          </Alert>
        )}
        <div className="flex items-center justify-between">
          <Label htmlFor="detectRandomId">Detect Random _id</Label>
          <Switch id="detectRandomId" checked={form.watch("detectRandomId")}
            onCheckedChange={(v) => form.setValue("detectRandomId", v)} />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="preExisting">Allow Pre-existing Destination Data</Label>
          <Switch id="preExisting" checked={form.watch("preExistingDestinationData")}
            onCheckedChange={(v) => form.setValue("preExistingDestinationData", v)} />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="buildIndexes">Build Indexes</Label>
          <select id="buildIndexes" className="rounded border px-2 py-1 text-sm" {...form.register("buildIndexes")}>
            <option value="afterDataCopy">afterDataCopy</option>
            <option value="beforeDataCopy">beforeDataCopy</option>
            <option value="excludeHashed">excludeHashed</option>
            <option value="excludeHashedAfterCopy">excludeHashedAfterCopy</option>
            <option value="never">never</option>
          </select>
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="verification">Enable Embedded Verification</Label>
          <Switch id="verification" checked={form.watch("verificationEnabled")}
            onCheckedChange={(v) => form.setValue("verificationEnabled", v)} />
        </div>
      </div>

      <Collapsible>
        <CollapsibleTrigger className="w-full text-left px-2 py-1 text-sm font-medium hover:bg-accent rounded">
          + Namespace Filtering
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-4 pt-2">
          <NamespaceFilterFields control={form.control} register={form.register}
            name="includeNamespaces" label="Include" />
          <NamespaceFilterFields control={form.control} register={form.register}
            name="excludeNamespaces" label="Exclude" />
        </CollapsibleContent>
      </Collapsible>

      <Collapsible>
        <CollapsibleTrigger className="w-full text-left px-2 py-1 text-sm font-medium hover:bg-accent rounded">
          + Advanced (performance &amp; logging)
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label>Load Level: {form.watch("loadLevel")} (1 = gentlest, 4 = fastest)</Label>
            <Slider min={1} max={4} step={1} value={[form.watch("loadLevel")]}
              onValueChange={(v) => form.setValue("loadLevel", Array.isArray(v) ? v[0] : v)} />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="verbosity">Log Verbosity</Label>
            <select id="verbosity" className="rounded border px-2 py-1 text-sm" {...form.register("verbosity")}>
              {["TRACE", "DEBUG", "INFO", "WARN", "ERROR", "FATAL", "PANIC"].map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>
        </CollapsibleContent>
      </Collapsible>

      <Button type="submit" disabled={submitting || (reversible && hasFilters)} className="w-full">
        {submitting ? "Creating..." : "Create & Start Migration"}
      </Button>
    </form>
  );
}
