"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  migrationFormSchema,
  formValuesToConfig,
  connToConfig,
  sameHostSet,
  type MigrationFormValues,
} from "@/lib/schemas";
import { buildConnectionString } from "@/lib/connection";
import { Topbar } from "@/components/app-shell/topbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ConnectionBuilder } from "@/components/connection-builder";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { nanoid } from "nanoid";

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

// A self-contained destination connection: it owns its own react-hook-form so we can
// reuse the shared ConnectionBuilder (which is bound to MigrationFormValues + side="dest")
// unchanged. It publishes its current values to the parent via a registry ref.
function DestinationRow({
  regKey,
  index,
  total,
  token,
  register,
  unregister,
  onRemove,
  status,
}: {
  regKey: string;
  index: number;
  total: number;
  token: string;
  register: (id: string, getter: () => MigrationFormValues) => void;
  unregister: (id: string) => void;
  onRemove: () => void;
  status?: { ok: boolean; text: string };
}) {
  // Only the `dest` side + name are meaningful here; source/options come from the parent.
  const form = useForm<MigrationFormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(migrationFormSchema) as any,
    defaultValues: {
      name: "", source: { ...emptyConn }, dest: { ...emptyConn },
      reversible: false, buildIndexes: "beforeDataCopy", detectRandomId: true,
      preExistingDestinationData: false, verificationEnabled: false,
      loadLevel: 3, verbosity: "INFO",
      includeNamespaces: [], excludeNamespaces: [], shardingEntries: [],
    },
  });

  // Publish this row's value-getter to the parent so it can read live values on submit and
  // find them by the same id used for ordering/removal. The parent owns the actual store.
  useEffect(() => {
    register(regKey, () => form.getValues());
    return () => unregister(regKey);
  }, [regKey, register, unregister, form]);
  const key = regKey;

  return (
    <div className={sectionClass}>
      <div className="flex items-center justify-between">
        <p className={sectionHeaderClass}>Destination {index + 1}</p>
        {total > 1 && (
          <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
            Remove
          </Button>
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor={`dest-name-${key}`}>Migration name</Label>
        <Input
          id={`dest-name-${key}`}
          {...form.register("name")}
          placeholder={`Destination ${index + 1}`}
        />
        {form.formState.errors.name && (
          <p className="text-sm text-destructive">{form.formState.errors.name.message}</p>
        )}
      </div>
      <ConnectionBuilder side="dest" label="Destination cluster" form={form} token={token} />
      {status && (
        <Alert variant={status.ok ? "default" : "destructive"}>
          <AlertDescription>{status.text}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

type SubmitResult = { ok: boolean; text: string };

export default function NewMultiMigrationPage() {
  const router = useRouter();
  // Shared cert-staging token covers the source + all destinations' uploads.
  const tokenRef = useRef(nanoid());
  // Maps a stable destination key → getter for that row's current form values.
  const destRegistry = useRef<Record<string, () => MigrationFormValues>>({});

  const [groupName, setGroupName] = useState("");
  // Destination rows are tracked by stable ids; each id maps to a DestinationRow.
  const [destIds, setDestIds] = useState<string[]>(() => [nanoid(), nanoid()]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Per-destination create result, keyed by the row index at submit time.
  const [results, setResults] = useState<Record<number, SubmitResult>>({});

  // Source + shared sync options live in one form; we only read its source side + options.
  const form = useForm<MigrationFormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(migrationFormSchema) as any,
    defaultValues: {
      name: "shared", source: { ...emptyConn }, dest: { ...emptyConn },
      reversible: false, buildIndexes: "beforeDataCopy", detectRandomId: true,
      preExistingDestinationData: false, verificationEnabled: false,
      loadLevel: 3, verbosity: "INFO",
      includeNamespaces: [], excludeNamespaces: [], shardingEntries: [],
    },
  });

  // The registry is owned here; children publish/withdraw their getters via these callbacks
  // (mutating our own ref, which the compiler permits — unlike mutating a ref prop).
  const register = useCallback((id: string, getter: () => MigrationFormValues) => {
    destRegistry.current[id] = getter;
  }, []);
  const unregister = useCallback((id: string) => {
    delete destRegistry.current[id];
  }, []);

  const addDestination = useCallback(() => {
    setDestIds((ids) => [...ids, nanoid()]);
  }, []);

  const removeDestination = useCallback((id: string) => {
    setDestIds((ids) => (ids.length > 1 ? ids.filter((x) => x !== id) : ids));
  }, []);

  const onSubmit = async () => {
    setError(null);
    setResults({});

    if (!groupName.trim()) {
      setError("Group name is required.");
      return;
    }

    const shared = form.getValues();
    const sourceConn = connToConfig(shared.source);
    const sourceUri = buildConnectionString(sourceConn);
    if (!sourceUri || sourceUri === "mongodb:///") {
      setError("Provide a source connection.");
      return;
    }

    // Collect destination values from each registered row, in display order.
    const dests = destIds
      .map((id) => destRegistry.current[id])
      .filter((g): g is () => MigrationFormValues => typeof g === "function")
      .map((g) => g());

    if (dests.length === 0) {
      setError("Add at least one destination.");
      return;
    }

    // Client-side enforcement: every destination must differ from the shared source and
    // must itself be a real connection. (The server re-checks source ≠ destination too.)
    for (let i = 0; i < dests.length; i++) {
      const dConn = connToConfig(dests[i].dest);
      const dUri = buildConnectionString(dConn);
      if (!dUri || dUri === "mongodb:///") {
        setError(`Destination ${i + 1} is missing a connection.`);
        return;
      }
      if (sameHostSet(sourceUri, dUri)) {
        setError(`Destination ${i + 1} resolves to the same cluster as the source.`);
        return;
      }
    }

    setSubmitting(true);
    const config = formValuesToConfig(shared);
    const nextResults: Record<number, SubmitResult> = {};
    let anyFailed = false;

    // One POST per destination, all carrying the same groupName + shared source/config.
    for (let i = 0; i < dests.length; i++) {
      const d = dests[i];
      const name = d.name.trim() || `${groupName.trim()} → ${i + 1}`;
      try {
        const res = await fetch("/api/migrations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            groupName: groupName.trim(),
            sourceConn,
            destConn: connToConfig(d.dest),
            token: tokenRef.current,
            config,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          nextResults[i] = { ok: true, text: `Created "${name}"` };
        } else {
          anyFailed = true;
          nextResults[i] = { ok: false, text: data?.error || `Failed to create "${name}"` };
        }
      } catch (err) {
        anyFailed = true;
        nextResults[i] = { ok: false, text: (err as Error).message };
      }
      setResults({ ...nextResults });
    }

    setSubmitting(false);
    // If everything succeeded, go to the dashboard where the group now appears.
    if (!anyFailed) router.push("/");
  };

  const reversible = form.watch("reversible");

  return (
    <>
      <Topbar
        title="New multi-destination sync"
        subtitle="One source → many destinations, grouped together"
      />
      <div className="max-w-2xl animate-fade-in space-y-6 px-6 py-6">
        {/* ── Group ── */}
        <div className={sectionClass}>
          <p className={sectionHeaderClass}>Group</p>
          <p className={sectionHelperClass}>
            All destinations below are created as independent migrations tied to this group.
          </p>
          <div className="space-y-2">
            <Label htmlFor="groupName">Group name</Label>
            <Input
              id="groupName"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="My fan-out migration"
            />
          </div>
        </div>

        {/* ── Source ── */}
        <div className={sectionClass}>
          <p className={sectionHeaderClass}>Source</p>
          <p className={sectionHelperClass}>The single source cluster copied to every destination.</p>
          <ConnectionBuilder side="source" label="Source cluster" form={form} token={tokenRef.current} />
        </div>

        {/* ── Destinations ── */}
        {destIds.map((id, i) => (
          <DestinationRow
            key={id}
            regKey={id}
            index={i}
            total={destIds.length}
            token={tokenRef.current}
            register={register}
            unregister={unregister}
            onRemove={() => removeDestination(id)}
            status={results[i]}
          />
        ))}

        <Button type="button" variant="outline" onClick={addDestination} className="w-full">
          + Add destination
        </Button>

        {/* ── Shared sync options ── */}
        <div className={sectionClass}>
          <p className={sectionHeaderClass}>Shared sync options</p>
          <p className={sectionHelperClass}>Applied to every destination migration.</p>

          <div className="flex items-center justify-between">
            <Label htmlFor="reversible">Reversible</Label>
            <Switch
              id="reversible"
              checked={reversible}
              onCheckedChange={(v) => form.setValue("reversible", v)}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="detectRandomId">Detect random _id</Label>
            <Switch
              id="detectRandomId"
              checked={form.watch("detectRandomId")}
              onCheckedChange={(v) => form.setValue("detectRandomId", v)}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="preExisting">Allow pre-existing destination data</Label>
            <Switch
              id="preExisting"
              checked={form.watch("preExistingDestinationData")}
              onCheckedChange={(v) => form.setValue("preExistingDestinationData", v)}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="buildIndexes">Build indexes</Label>
            <select id="buildIndexes" className={selectClass} {...form.register("buildIndexes")}>
              <option value="afterDataCopy">afterDataCopy</option>
              <option value="beforeDataCopy">beforeDataCopy</option>
              <option value="excludeHashed">excludeHashed</option>
              <option value="excludeHashedAfterCopy">excludeHashedAfterCopy</option>
              <option value="never">never</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label>
              Load level: <span className="font-mono text-primary">{form.watch("loadLevel")}</span>
              <span className="ml-1 text-xs text-muted-foreground">(1 = gentlest, 4 = fastest)</span>
            </Label>
            <Slider
              min={1}
              max={4}
              step={1}
              value={[form.watch("loadLevel")]}
              onValueChange={(v) => form.setValue("loadLevel", Array.isArray(v) ? v[0] : v)}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="verbosity">Log verbosity</Label>
            <select id="verbosity" className={selectClass} {...form.register("verbosity")}>
              {["TRACE", "DEBUG", "INFO", "WARN", "ERROR", "FATAL", "PANIC"].map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>
        </div>

        {/* ── Submit ── */}
        <div className="sticky bottom-0 -mx-0 mt-2 border-t border-border bg-background/80 py-3 backdrop-blur">
          {error && (
            <Alert variant="destructive" className="mb-3">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Button type="button" onClick={onSubmit} disabled={submitting} className="w-full">
            {submitting
              ? "Creating…"
              : `Create & start ${destIds.length} migration${destIds.length === 1 ? "" : "s"}`}
          </Button>
        </div>
      </div>
    </>
  );
}
