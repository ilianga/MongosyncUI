"use client";

import { useCallback, useState } from "react";
import { useForm } from "react-hook-form";
import { nanoid } from "nanoid";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Topbar } from "@/components/app-shell/topbar";
import { ConnectionBuilder } from "@/components/connection-builder";
import { ConnectionDoctor } from "@/components/connection-doctor";
import { Stethoscope } from "lucide-react";
import { connToConfig, configToConnForm, type MigrationFormValues } from "@/lib/schemas";
import { CONNECTION_COLORS, DEFAULT_CONNECTION_COLOR, resolveConnectionColor } from "@/lib/colors";
import { maskUri } from "@/lib/format";
import type { SavedConnection } from "@/lib/types";
import { usePolling } from "@/hooks/use-polling";
import { toast } from "sonner";

async function fetchConnections(signal: AbortSignal): Promise<SavedConnection[]> {
  const res = await fetch("/api/connections", { signal });
  if (!res.ok) throw new Error(`Failed to load connections (${res.status})`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

const emptyConn = {
  raw: "", scheme: "mongodb" as const, hosts: "", authMethod: "none" as const,
  username: "", password: "", authSource: "", authMechanism: "DEFAULT" as const,
  serviceName: "", awsSessionToken: "",
  tlsEnabled: false, tlsCaFile: "", tlsCertKeyFile: "", tlsCertKeyPassword: "",
  tlsAllowInvalidCertificates: false, tlsAllowInvalidHostnames: false,
};

// The ConnectionBuilder edits MigrationFormValues[side]; this page only uses the "source"
// side and ignores the rest of the migration shape.
const formDefaults: MigrationFormValues = {
  name: "", source: { ...emptyConn }, dest: { ...emptyConn },
  reversible: false, buildIndexes: "afterDataCopy", detectRandomId: true,
  preExistingDestinationData: false, verificationEnabled: true,
  loadLevel: 3, verbosity: "INFO",
  includeNamespaces: [], excludeNamespaces: [], shardingEntries: [],
};

const AUTH_LABELS: Record<string, string> = {
  none: "No auth", password: "Username/Password", x509: "X.509",
  kerberos: "Kerberos", ldap: "LDAP", aws: "AWS IAM", oidc: "OIDC",
};

function summarize(c: SavedConnection): string {
  const conn = c.conn;
  if (conn.raw?.trim()) return maskUri(conn.raw.trim());
  const host = (conn.hosts ?? []).join(", ") || "(no host)";
  const method = AUTH_LABELS[conn.authMethod ?? "none"] ?? conn.authMethod ?? "No auth";
  return `${host} · ${method}`;
}

export default function ConnectionsPage() {
  const [editing, setEditing] = useState<SavedConnection | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(DEFAULT_CONNECTION_COLOR);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SavedConnection | null>(null);
  const [doctorTarget, setDoctorTarget] = useState<SavedConnection | null>(null);
  // Cert-staging token for the builder's TLS uploads (unused on save — connections don't
  // commit certs — but the builder requires it). Stable for the page's lifetime.
  const [token] = useState(() => nanoid());

  const form = useForm<MigrationFormValues>({ defaultValues: formDefaults });

  // One-shot load (no interval) with abort-on-unmount; refreshed manually after
  // create/update/delete via `load`.
  const { data, error: loadError, loading, refresh } = usePolling<SavedConnection[]>(
    fetchConnections,
    { intervalMs: 0 },
  );
  const connections = data ?? [];
  const load = useCallback(() => {
    void refresh();
  }, [refresh]);

  const openCreate = () => {
    setEditing(null);
    setCreating(true);
    setError(null);
    setName("");
    setColor(DEFAULT_CONNECTION_COLOR);
    form.reset(formDefaults);
  };

  const openEdit = (c: SavedConnection) => {
    setEditing(c);
    setCreating(false);
    setError(null);
    setName(c.name);
    setColor(c.color || DEFAULT_CONNECTION_COLOR);
    form.reset({ ...formDefaults, source: { ...emptyConn, ...configToConnForm(c.conn) } });
  };

  const closeForm = () => { setCreating(false); setEditing(null); };

  const save = async () => {
    if (!name.trim()) { setError("Name is required"); return; }
    setSaving(true);
    setError(null);
    try {
      const conn = connToConfig(form.getValues().source);
      const payload = { name: name.trim(), color, conn };
      const url = editing ? `/api/connections/${editing.id}` : "/api/connections";
      const method = editing ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Save failed");
      toast.success(editing ? "Connection updated" : "Connection saved");
      closeForm();
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      const res = await fetch(`/api/connections/${deleteTarget.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || "Delete failed");
      }
      toast.success("Connection deleted");
      if (editing?.id === deleteTarget.id) closeForm();
      load();
    } catch (e) {
      toast.error("Delete failed", { description: (e as Error).message });
    } finally {
      setDeleteTarget(null);
    }
  };

  const showForm = creating || editing !== null;

  return (
    <>
      <Topbar title="Connections" />
      <div className="max-w-2xl space-y-6 animate-fade-in pt-6">

        <Card>
          <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle>Saved Connections</CardTitle>
              <CardDescription>
                Reusable, colour-tagged cluster connections. Pick one when creating a migration.
              </CardDescription>
            </div>
            {!showForm && <Button onClick={openCreate}>New connection</Button>}
          </CardHeader>
          <CardContent className="space-y-3">
            {loading && connections.length === 0 && (
              <p className="text-sm text-muted-foreground">Loading connections…</p>
            )}
            {!loading && loadError && connections.length === 0 && (
              <div className="space-y-2">
                <p className="text-sm text-destructive">Couldn&apos;t load connections.</p>
                <Button variant="outline" size="sm" onClick={load}>Retry</Button>
              </div>
            )}
            {!loading && !error && connections.length === 0 && !showForm && (
              <p className="text-sm text-muted-foreground">No saved connections yet.</p>
            )}
            {connections.map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-3 rounded-md border border-border p-3"
              >
                <span
                  className="h-3.5 w-3.5 shrink-0 rounded-full"
                  style={{ background: resolveConnectionColor(c.color) }}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{c.name}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">{summarize(c)}</p>
                </div>
                <Button variant="ghost" size="icon-sm" title="Run diagnostics"
                  aria-label="Run diagnostics" onClick={() => setDoctorTarget(c)}>
                  <Stethoscope />
                </Button>
                <Button variant="outline" size="sm" onClick={() => openEdit(c)}>Edit</Button>
                <Button variant="ghost" size="sm" className="text-destructive"
                  onClick={() => setDeleteTarget(c)}>Delete</Button>
              </div>
            ))}
          </CardContent>
        </Card>

        {showForm && (
          <Card>
            <CardHeader>
              <CardTitle>{editing ? "Edit connection" : "New connection"}</CardTitle>
              <CardDescription>
                Configure the cluster connection, give it a name and a colour.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="connName">Name</Label>
                <Input id="connName" value={name} placeholder="e.g. Prod Atlas"
                  onChange={(e) => setName(e.target.value)} />
              </div>

              <div className="space-y-2">
                <Label>Colour</Label>
                <div className="flex flex-wrap items-center gap-2">
                  {CONNECTION_COLORS.map((c) => (
                    <button
                      key={c.name}
                      type="button"
                      title={c.name}
                      onClick={() => setColor(c.name)}
                      className={`h-6 w-6 rounded-full border-2 ${
                        color === c.name ? "border-foreground" : "border-transparent"
                      }`}
                      style={{ background: c.value }}
                      aria-label={c.name}
                    />
                  ))}
                </div>
              </div>

              <ConnectionBuilder
                side="source"
                label="Cluster Connection"
                form={form}
                token={token}
                showSavedConnections={false}
              />

              {error && <p className="text-sm text-destructive">{error}</p>}

              <div className="flex gap-2">
                <Button onClick={save} disabled={saving}>
                  {saving ? "Saving..." : editing ? "Update connection" : "Save connection"}
                </Button>
                <Button variant="outline" onClick={closeForm} disabled={saving}>Cancel</Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <ConnectionDoctor
        key={doctorTarget?.id ?? "none"}
        connection={doctorTarget}
        onOpenChange={(v) => { if (!v) setDoctorTarget(null); }}
      />

      <Dialog open={deleteTarget !== null} onOpenChange={(v) => { if (!v) setDeleteTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete connection</DialogTitle>
            <DialogDescription>
              Delete the saved connection &ldquo;{deleteTarget?.name}&rdquo;? This only removes the
              saved entry; existing migrations are unaffected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
