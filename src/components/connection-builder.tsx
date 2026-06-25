"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useEffect, useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import { connToConfig, configToConnForm, type MigrationFormValues } from "@/lib/schemas";
import { CONNECTION_COLORS, DEFAULT_CONNECTION_COLOR } from "@/lib/colors";
import type { SavedConnection } from "@/lib/types";

const selectClass =
  "bg-background border border-input rounded-md px-2 py-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

type Side = "source" | "dest";
type AuthMethod = MigrationFormValues["source"]["authMethod"];

const AUTH_METHODS: { value: AuthMethod; label: string }[] = [
  { value: "none", label: "None" },
  { value: "password", label: "Username/Password" },
  { value: "oidc", label: "OIDC" },
  { value: "x509", label: "X.509" },
  { value: "kerberos", label: "Kerberos" },
  { value: "ldap", label: "LDAP" },
  { value: "aws", label: "AWS IAM" },
];

/**
 * Compass-style structured connection builder for one cluster (source or dest). Edits a
 * flat `MigrationFormValues[side]` object via react-hook-form. Cert uploads POST the PEM
 * to /api/cluster-check/cert under the shared `token` and store the returned path in the
 * form so create can move it into the migration's permanent dir.
 */
export function ConnectionBuilder({
  side,
  label,
  form,
  token,
  showSavedConnections = true,
}: {
  side: Side;
  label: string;
  form: UseFormReturn<MigrationFormValues>;
  token: string;
  /** When true (default), shows the "use a saved connection" picker + "save as" affordance. */
  showSavedConnections?: boolean;
}) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ status: "ok" | "warn" | "error"; msg: string } | null>(null);
  const [uploadErr, setUploadErr] = useState<string | null>(null);

  const f = (k: keyof MigrationFormValues["source"]) => `${side}.${k}` as const;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = (k: keyof MigrationFormValues["source"]): any => form.watch(f(k) as any);
  const setVal = (k: keyof MigrationFormValues["source"], v: unknown) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    form.setValue(f(k) as any, v as any, { shouldValidate: true });

  // Load every field of one flat connection form object into this side's form values.
  const loadConnForm = (cf: ReturnType<typeof configToConnForm>) => {
    (Object.keys(cf) as (keyof typeof cf)[]).forEach((k) =>
      setVal(k as keyof MigrationFormValues["source"], cf[k])
    );
  };

  // ── Saved connections (picker + "save as") ──
  const [saved, setSaved] = useState<SavedConnection[]>([]);
  const [savingOpen, setSavingOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveColor, setSaveColor] = useState<string>(DEFAULT_CONNECTION_COLOR);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const loadSaved = () => {
    fetch("/api/connections")
      .then((r) => (r.ok ? r.json() : []))
      .then((data: SavedConnection[]) => setSaved(Array.isArray(data) ? data : []))
      .catch(() => {});
  };
  useEffect(() => {
    if (showSavedConnections) loadSaved();
  }, [showSavedConnections]);

  const applySaved = (id: string) => {
    const sc = saved.find((s) => s.id === id);
    if (!sc) return;
    loadConnForm(configToConnForm(sc.conn));
    setResult(null);
  };

  const saveAsConnection = async () => {
    setSaveBusy(true);
    setSaveMsg(null);
    try {
      const conn = connToConfig(form.getValues()[side]);
      const res = await fetch("/api/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: saveName.trim(), color: saveColor, conn }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Save failed");
      setSaveMsg({ ok: true, text: `Saved "${data.name}"` });
      setSaveName("");
      setSavingOpen(false);
      loadSaved();
    } catch (e) {
      setSaveMsg({ ok: false, text: (e as Error).message });
    } finally {
      setSaveBusy(false);
    }
  };

  const authMethod = (w("authMethod") ?? "none") as AuthMethod;
  const raw = (w("raw") ?? "") as string;
  const tlsEnabled = !!w("tlsEnabled");

  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      const conn = connToConfig(form.getValues()[side]);
      const res = await fetch("/api/cluster-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conn }),
      });
      const data = await res.json();
      if (!data.reachable) setResult({ status: "error", msg: data.error || "Unreachable" });
      else if (data.warning) setResult({ status: "warn", msg: data.warning });
      else
        setResult({
          status: "ok",
          msg: data.version ? `Reachable — MongoDB ${data.version} (replica set)` : "Reachable",
        });
    } catch (e) {
      setResult({ status: "error", msg: (e as Error).message });
    } finally {
      setTesting(false);
    }
  };

  const uploadCert = async (kind: "ca" | "certKey", file: File) => {
    setUploadErr(null);
    try {
      const pem = await file.text();
      const res = await fetch("/api/cluster-check/cert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, kind, pem }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Upload failed");
      setVal(kind === "ca" ? "tlsCaFile" : "tlsCertKeyFile", data.path);
    } catch (e) {
      setUploadErr((e as Error).message);
    }
  };

  return (
    <div className="rounded-md border border-border p-4 space-y-4">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-semibold">{label}</Label>
        <Button type="button" variant="outline" size="sm" disabled={testing} onClick={test}>
          {testing ? "Testing..." : "Test"}
        </Button>
      </div>

      {showSavedConnections && (
        <div className="space-y-2 rounded-md border border-dashed border-border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Label className="text-xs">Use a saved connection</Label>
            <select
              className={selectClass}
              value=""
              disabled={saved.length === 0}
              onChange={(e) => {
                if (e.target.value) applySaved(e.target.value);
              }}
            >
              <option value="">{saved.length ? "Select…" : "No saved connections"}</option>
              {saved.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ml-auto text-xs"
              onClick={() => {
                setSavingOpen((o) => !o);
                setSaveMsg(null);
              }}
            >
              {savingOpen ? "Cancel" : "Save as connection"}
            </Button>
          </div>

          {savingOpen && (
            <div className="space-y-2 pt-1">
              <Input
                placeholder="Connection name"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
              />
              <div className="flex flex-wrap items-center gap-2">
                {CONNECTION_COLORS.map((c) => (
                  <button
                    key={c.name}
                    type="button"
                    title={c.name}
                    onClick={() => setSaveColor(c.name)}
                    className={`h-5 w-5 rounded-full border-2 ${
                      saveColor === c.name ? "border-foreground" : "border-transparent"
                    }`}
                    style={{ background: c.value }}
                    aria-label={c.name}
                  />
                ))}
                <Button
                  type="button"
                  size="sm"
                  className="ml-auto"
                  disabled={saveBusy || !saveName.trim()}
                  onClick={saveAsConnection}
                >
                  {saveBusy ? "Saving..." : "Save"}
                </Button>
              </div>
            </div>
          )}

          {saveMsg && (
            <p className={`text-xs ${saveMsg.ok ? "text-primary" : "text-destructive"}`}>
              {saveMsg.text}
            </p>
          )}
        </div>
      )}

      {/* Advanced: paste a connection string (escape hatch → conn.raw) */}
      <Collapsible>
        <CollapsibleTrigger className="text-xs font-medium text-muted-foreground hover:text-foreground">
          Advanced: paste connection string
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2">
          <Input
            placeholder="mongodb://user:pass@host:27017/?..."
            className="font-mono text-xs"
            value={raw}
            onChange={(e) => setVal("raw", e.target.value)}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            When set, this overrides every field below and is used verbatim.
          </p>
        </CollapsibleContent>
      </Collapsible>

      {!raw.trim() && (
        <>
          {/* Scheme + hosts */}
          <div className="grid grid-cols-[auto_1fr] gap-2 items-end">
            <div className="space-y-1">
              <Label className="text-xs">Scheme</Label>
              <select
                className={selectClass}
                value={w("scheme") ?? "mongodb"}
                onChange={(e) => setVal("scheme", e.target.value)}
              >
                <option value="mongodb">mongodb</option>
                <option value="mongodb+srv">mongodb+srv</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Host(s)</Label>
              <Input
                placeholder="host1:27017, host2:27017"
                className="font-mono text-xs"
                value={w("hosts") ?? ""}
                onChange={(e) => setVal("hosts", e.target.value)}
              />
            </div>
          </div>
          {form.formState.errors[side]?.hosts && (
            <p className="text-xs text-destructive">
              {form.formState.errors[side]?.hosts?.message as string}
            </p>
          )}

          {/* Authentication method */}
          <div className="space-y-1">
            <Label className="text-xs">Authentication Method</Label>
            <select
              className={`${selectClass} w-full`}
              value={authMethod}
              onChange={(e) => setVal("authMethod", e.target.value)}
            >
              {AUTH_METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          {authMethod === "oidc" && (
            <Alert>
              <AlertDescription className="text-xs">
                Interactive OIDC generally cannot complete for an unattended mongosync process. It
                only works with a machine / callback (workload) workflow. The config is still emitted.
              </AlertDescription>
            </Alert>
          )}

          {/* Per-method credential fields */}
          {(authMethod === "password" || authMethod === "ldap") && (
            <CredentialFields w={w} setVal={setVal} userLabel="Username" passLabel="Password" />
          )}
          {authMethod === "aws" && (
            <>
              <CredentialFields
                w={w}
                setVal={setVal}
                userLabel="Access Key ID"
                passLabel="Secret Access Key"
              />
              <Field label="Session Token (optional)" valKey="awsSessionToken" w={w} setVal={setVal} />
            </>
          )}
          {authMethod === "kerberos" && (
            <>
              <Field label="Principal (user@REALM)" valKey="username" w={w} setVal={setVal} />
              <div className="grid grid-cols-2 gap-2">
                <Field label="Service Name" valKey="serviceName" w={w} setVal={setVal} placeholder="mongodb" />
                <Field
                  label="Service Realm (optional)"
                  valKey="serviceRealm"
                  w={w}
                  setVal={setVal}
                  placeholder="REALM.COM"
                />
              </div>
              <div className="flex items-center justify-between">
                <Label className="text-xs">Canonicalize host name</Label>
                <Switch
                  checked={!!w("canonicalizeHostName")}
                  onCheckedChange={(v) => setVal("canonicalizeHostName", v)}
                />
              </div>
            </>
          )}
          {authMethod === "x509" && (
            <Field
              label="Username (optional, from cert if blank)"
              valKey="username"
              w={w}
              setVal={setVal}
            />
          )}
          {authMethod === "oidc" && (
            <>
              <Field label="Username (optional)" valKey="username" w={w} setVal={setVal} />
              <div className="grid grid-cols-2 gap-2">
                <Field
                  label="Environment (optional)"
                  valKey="oidcEnvironment"
                  w={w}
                  setVal={setVal}
                  placeholder="azure | gcp | k8s | test"
                />
                <Field
                  label="Token Resource (optional)"
                  valKey="oidcTokenResource"
                  w={w}
                  setVal={setVal}
                  placeholder="audience / token resource"
                />
              </div>
            </>
          )}

          {/* Mechanism + auth database (password only) */}
          {authMethod === "password" && (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Authentication Mechanism</Label>
                <select
                  className={`${selectClass} w-full`}
                  value={w("authMechanism") ?? "DEFAULT"}
                  onChange={(e) => setVal("authMechanism", e.target.value)}
                >
                  <option value="DEFAULT">Default</option>
                  <option value="SCRAM-SHA-1">SCRAM-SHA-1</option>
                  <option value="SCRAM-SHA-256">SCRAM-SHA-256</option>
                </select>
              </div>
              <Field label="Authentication Database" valKey="authSource" w={w} setVal={setVal} placeholder="admin" />
            </div>
          )}

          {/* TLS / SSL */}
          <Collapsible>
            <CollapsibleTrigger className="text-xs font-semibold text-foreground hover:text-primary">
              TLS / SSL
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-3 pt-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Enable TLS/SSL</Label>
                <Switch checked={tlsEnabled} onCheckedChange={(v) => setVal("tlsEnabled", v)} />
              </div>
              {tlsEnabled && (
                <>
                  <div className="space-y-1">
                    <Label className="text-xs">CA Certificate (.pem, for self-signed)</Label>
                    <Input
                      type="file"
                      accept=".pem,.crt,.cer"
                      onChange={(e) => e.target.files?.[0] && uploadCert("ca", e.target.files[0])}
                    />
                    {w("tlsCaFile") && (
                      <p className="text-xs text-muted-foreground truncate">Uploaded: {w("tlsCaFile")}</p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Client Certificate Key (.pem, for X.509)</Label>
                    <Input
                      type="file"
                      accept=".pem,.crt,.cer"
                      onChange={(e) => e.target.files?.[0] && uploadCert("certKey", e.target.files[0])}
                    />
                    {w("tlsCertKeyFile") && (
                      <p className="text-xs text-muted-foreground truncate">
                        Uploaded: {w("tlsCertKeyFile")}
                      </p>
                    )}
                  </div>
                  <Field
                    label="Client Cert Key Password (optional)"
                    valKey="tlsCertKeyPassword"
                    type="password"
                    w={w}
                    setVal={setVal}
                  />
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Allow invalid hostnames</Label>
                    <Switch
                      checked={!!w("tlsAllowInvalidHostnames")}
                      onCheckedChange={(v) => setVal("tlsAllowInvalidHostnames", v)}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-destructive">
                      Allow invalid certificates (insecure)
                    </Label>
                    <Switch
                      checked={!!w("tlsAllowInvalidCertificates")}
                      onCheckedChange={(v) => setVal("tlsAllowInvalidCertificates", v)}
                    />
                  </div>
                  {w("tlsAllowInvalidCertificates") && (
                    <Alert variant="destructive">
                      <AlertDescription className="text-xs">
                        Disabling certificate validation is insecure and exposes the connection to
                        man-in-the-middle attacks. Prefer uploading the CA certificate instead.
                      </AlertDescription>
                    </Alert>
                  )}
                  {uploadErr && <p className="text-xs text-destructive">{uploadErr}</p>}
                </>
              )}
            </CollapsibleContent>
          </Collapsible>
        </>
      )}

      {result &&
        (result.status === "ok" ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-[#00684A] dark:text-[#71F6BA]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#00684A] dark:bg-[#71F6BA]" aria-hidden />
            {result.msg}
          </span>
        ) : result.status === "warn" ? (
          <span className="inline-flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden />
            {result.msg}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-xs text-destructive">
            <span className="h-1.5 w-1.5 rounded-full bg-destructive" aria-hidden />
            {result.msg}
          </span>
        ))}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Getter = (k: keyof MigrationFormValues["source"]) => any;
type Setter = (k: keyof MigrationFormValues["source"], v: unknown) => void;

function Field({
  label,
  valKey,
  w,
  setVal,
  type = "text",
  placeholder,
}: {
  label: string;
  valKey: keyof MigrationFormValues["source"];
  w: Getter;
  setVal: Setter;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input
        type={type}
        placeholder={placeholder}
        value={w(valKey) ?? ""}
        onChange={(e) => setVal(valKey, e.target.value)}
      />
    </div>
  );
}

function CredentialFields({
  w,
  setVal,
  userLabel,
  passLabel,
}: {
  w: Getter;
  setVal: Setter;
  userLabel: string;
  passLabel: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Field label={userLabel} valKey="username" w={w} setVal={setVal} />
      <Field label={passLabel} valKey="password" type="password" w={w} setVal={setVal} />
    </div>
  );
}
