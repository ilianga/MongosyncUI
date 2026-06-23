"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { migrationFormSchema, formValuesToConfig, connToConfig, type MigrationFormValues } from "@/lib/schemas";
import { buildConnectionString } from "@/lib/connection";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ConnectionBuilder } from "./connection-builder";
import { NamespaceFilterFields } from "./namespace-filter-fields";
import { useRouter } from "next/navigation";
import { useState, useRef } from "react";
import { nanoid } from "nanoid";
import { cn } from "@/lib/utils";

const emptyConn = {
  raw: "", scheme: "mongodb" as const, hosts: "", authMethod: "none" as const,
  username: "", password: "", authSource: "", authMechanism: "DEFAULT" as const,
  serviceName: "", awsSessionToken: "",
  tlsEnabled: false, tlsCaFile: "", tlsCertKeyFile: "", tlsCertKeyPassword: "",
  tlsAllowInvalidCertificates: false, tlsAllowInvalidHostnames: false,
};

const sectionClass = "rounded-lg border border-border bg-card p-5 space-y-4";
const sectionHeaderClass = "text-sm font-semibold text-foreground";
const sectionHelperClass = "text-xs text-muted-foreground -mt-2";
const selectClass =
  "bg-background border border-input rounded-md px-2 py-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function MigrationForm() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // When the destination has leftover mongosync state, we hold the submitted values
  // and prompt the user to drop it and retry instead of failing with a raw timeout.
  const [staleState, setStaleState] = useState<MigrationFormValues | null>(null);
  const [dropping, setDropping] = useState(false);
  // Single cert-staging token shared by both clusters' uploads, submitted on create so the
  // server moves staged PEMs into the migration's permanent cert dir.
  const tokenRef = useRef(nanoid());

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const form = useForm<MigrationFormValues>({
    resolver: zodResolver(migrationFormSchema) as any,
    defaultValues: {
      name: "", source: { ...emptyConn }, dest: { ...emptyConn },
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

  // Returns the parsed response so callers can branch on the DEST_HAS_SYNC_STATE code.
  const postCreate = async (values: MigrationFormValues) => {
    const res = await fetch("/api/migrations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: values.name,
        sourceConn: connToConfig(values.source),
        destConn: connToConfig(values.dest),
        token: tokenRef.current,
        config: formValuesToConfig(values),
      }),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, code: data?.code as string | undefined, error: data?.error as string | undefined };
  };

  const onSubmit = async (values: MigrationFormValues) => {
    setSubmitting(true);
    setError(null);
    try {
      const r = await postCreate(values);
      if (r.ok) { router.push("/"); return; }
      if (r.code === "DEST_HAS_SYNC_STATE") { setStaleState(values); return; }
      setError(r.error || "Failed to create migration");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  // User confirmed dropping leftover sync state on the destination — drop it, then retry.
  const confirmDropAndRetry = async () => {
    if (!staleState) return;
    setDropping(true);
    setError(null);
    try {
      const drop = await fetch("/api/cluster-check/drop-sync-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uri: buildConnectionString(connToConfig(staleState.dest)) }),
      });
      const dropData = await drop.json().catch(() => ({}));
      if (!drop.ok) throw new Error(dropData?.error || "Failed to drop sync state");

      setSubmitting(true);
      const r = await postCreate(staleState);
      if (r.ok) { setStaleState(null); router.push("/"); return; }
      setError(r.error || "Retry failed after dropping sync state");
      setStaleState(null);
    } catch (err) {
      setError((err as Error).message);
      setStaleState(null);
    } finally {
      setDropping(false);
      setSubmitting(false);
    }
  };

  return (
    <>
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

        <ConnectionBuilder side="source" label="Source Cluster" form={form} token={tokenRef.current} />
        <ConnectionBuilder side="dest" label="Destination Cluster" form={form} token={tokenRef.current} />
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

    <Dialog open={staleState !== null} onOpenChange={(v) => { if (!v && !dropping) setStaleState(null); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Leftover sync state on destination</DialogTitle>
          <DialogDescription>
            The destination already has mongosync state (<code>__mdb_internal_mongosync</code>) from a
            previous run. mongosync will try to resume that old sync instead of starting fresh, so the
            migration never becomes ready.
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Drop that state database on the destination and start a fresh migration? This is mongosync&apos;s
          own bookkeeping — it does not delete your data.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => setStaleState(null)} disabled={dropping}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={confirmDropAndRetry} disabled={dropping}>
            {dropping ? "Dropping..." : "Drop & retry"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
