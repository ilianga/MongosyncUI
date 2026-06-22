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
import { cn } from "@/lib/utils";

const sectionClass = "rounded-lg border border-border bg-card p-5 space-y-4";
const sectionHeaderClass = "text-sm font-semibold text-foreground";
const sectionHelperClass = "text-xs text-muted-foreground -mt-2";
const selectClass =
  "bg-background border border-input rounded-md px-2 py-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

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
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
      {/* ── Connection ── */}
      <div className={sectionClass}>
        <p className={sectionHeaderClass}>Connection</p>
        <p className={sectionHelperClass}>Name this migration and provide cluster URIs.</p>

        <div className="space-y-2">
          <Label htmlFor="name">Migration Name</Label>
          <Input id="name" {...form.register("name")} placeholder="My Migration" />
          {form.formState.errors.name && (
            <p className="text-sm text-destructive">{form.formState.errors.name.message}</p>
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
      </div>

      {/* ── Sync Options ── */}
      <div className={sectionClass}>
        <p className={sectionHeaderClass}>Sync options</p>
        <p className={sectionHelperClass}>Configure how data is copied to the destination.</p>

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
          <select id="buildIndexes" className={selectClass} {...form.register("buildIndexes")}>
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

      {/* ── Namespace Filtering ── */}
      <div className={cn(sectionClass, "space-y-0")}>
        <Collapsible>
          <CollapsibleTrigger className="flex w-full items-center justify-between py-0.5 text-sm font-semibold text-foreground hover:text-primary transition-colors">
            <span>Namespace filtering</span>
            <span className="text-xs font-normal text-muted-foreground">Optional</span>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-4 pt-4">
            <p className={sectionHelperClass}>Limit sync to specific databases or collections.</p>
            <NamespaceFilterFields control={form.control} register={form.register}
              name="includeNamespaces" label="Include" />
            <NamespaceFilterFields control={form.control} register={form.register}
              name="excludeNamespaces" label="Exclude" />
          </CollapsibleContent>
        </Collapsible>
      </div>

      {/* ── Advanced ── */}
      <div className={cn(sectionClass, "space-y-0")}>
        <Collapsible>
          <CollapsibleTrigger className="flex w-full items-center justify-between py-0.5 text-sm font-semibold text-foreground hover:text-primary transition-colors">
            <span>Advanced</span>
            <span className="text-xs font-normal text-muted-foreground">Performance &amp; logging</span>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label>
                Load Level:{" "}
                <span className="font-mono text-primary">{form.watch("loadLevel")}</span>
                <span className="ml-1 text-xs text-muted-foreground">(1 = gentlest, 4 = fastest)</span>
              </Label>
              <Slider min={1} max={4} step={1} value={[form.watch("loadLevel")]}
                onValueChange={(v) => form.setValue("loadLevel", Array.isArray(v) ? v[0] : v)} />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="verbosity">Log Verbosity</Label>
              <select id="verbosity" className={selectClass} {...form.register("verbosity")}>
                {["TRACE", "DEBUG", "INFO", "WARN", "ERROR", "FATAL", "PANIC"].map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>

      {/* ── Sticky Submit Bar ── */}
      <div className="sticky bottom-0 -mx-0 mt-2 border-t border-border bg-background/80 py-3 backdrop-blur">
        {error && (
          <Alert variant="destructive" className="mb-3">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Button type="submit" disabled={submitting || (reversible && hasFilters)} className="w-full">
          {submitting ? "Creating..." : "Create & Start Migration"}
        </Button>
      </div>
    </form>
  );
}
