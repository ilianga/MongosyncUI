"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Topbar } from "@/components/app-shell/topbar";
import { usePolling } from "@/hooks/use-polling";
import { toast } from "sonner";

interface Settings {
  mongosyncPath: string;
  pollInterval: string;
  basePort: string;
  defaultLoadLevel: string;
  defaultVerbosity: string;
  defaultVerification: string;
  defaultDisableTelemetry: string;
  supervisionMode: string;
  backoffCapSec: string;
  crashLoopMax: string;
  crashLoopWindowSec: string;
  hungTicks: string;
}

const DEFAULTS: Settings = {
  mongosyncPath: "", pollInterval: "5000", basePort: "27182",
  defaultLoadLevel: "3", defaultVerbosity: "INFO",
  defaultVerification: "true", defaultDisableTelemetry: "false",
  supervisionMode: "supervised", backoffCapSec: "60", crashLoopMax: "5",
  crashLoopWindowSec: "300", hungTicks: "6",
};

const selectClass =
  "w-full bg-background border border-input rounded-md px-2 py-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export default function SettingsPage() {
  const [s, setS] = useState<Settings>(DEFAULTS);
  const [version, setVersion] = useState<string | null>(null);
  const [versionError, setVersionError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [boot, setBoot] = useState<{ installed: boolean; path: string; tmux: boolean; platform: string } | null>(null);
  const [cred, setCred] = useState({ currentPassword: "", username: "admin", password: "" });
  const [savingCred, setSavingCred] = useState(false);

  // One-shot loads (no interval) via usePolling: gives us abort-on-unmount and a
  // settled loading state. State is seeded inside the async fetcher (not a
  // synchronous setState in an effect), so the React Compiler lint rule is happy.
  // The editable form (`s`) diverges from server state after edits, so it lives
  // in its own state rather than being bound to the hook's `data`.
  const loadSettings = useCallback(async (signal: AbortSignal) => {
    const res = await fetch("/api/settings", { signal });
    if (!res.ok) throw new Error(`Failed to load settings (${res.status})`);
    const data = await res.json();
    if (signal.aborted) return null;
    setS({ ...DEFAULTS, ...Object.fromEntries(Object.entries(data).filter(([, v]) => v !== "")) });
    return null;
  }, []);
  usePolling(loadSettings, { intervalMs: 0 });

  const loadBoot = useCallback(async (signal: AbortSignal) => {
    const res = await fetch("/api/supervision", { signal });
    if (!res.ok) throw new Error(`Failed to load supervision status (${res.status})`);
    const data = await res.json();
    if (signal.aborted) return null;
    setBoot(data);
    return null;
  }, []);
  usePolling(loadBoot, { intervalMs: 0 });

  const set = (k: keyof Settings) => (v: string) => setS((prev) => ({ ...prev, [k]: v }));

  const toggleBoot = async (action: "install" | "uninstall") => {
    try {
      const res = await fetch("/api/supervision", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      toast.success(action === "install" ? "Boot service installed" : "Boot service removed", {
        description: data.followUp ? `Run: ${data.followUp}` : undefined, duration: 12000,
      });
      const r = await fetch("/api/supervision"); setBoot(await r.json());
    } catch (e) { toast.error("Failed", { description: (e as Error).message }); }
  };

  const testBinary = async () => {
    setTesting(true); setVersion(null); setVersionError(null);
    try {
      const res = await fetch("/api/mongosync/version");
      const data = await res.json();
      res.ok ? setVersion(data.version) : setVersionError(data.error);
    } catch (e) { setVersionError((e as Error).message); }
    finally { setTesting(false); }
  };

  const saveCredentials = async () => {
    setSavingCred(true);
    try {
      const res = await fetch("/api/auth/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cred),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to update credentials");
      toast.success("Credentials updated");
      setCred((c) => ({ ...c, currentPassword: "", password: "" }));
    } catch (e) {
      toast.error("Update failed", { description: (e as Error).message });
    } finally {
      setSavingCred(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(s),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save settings");
      }
      toast.success("Settings saved");
      // Verify the binary against the value we just persisted (the version
      // endpoint reads the saved setting), so Save doubles as a check.
      await testBinary();
    } catch (err) {
      toast.error("Save failed", { description: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Topbar title="Settings" />
      <div className="max-w-2xl space-y-6 animate-fade-in pt-6">

        <Card>
          <CardHeader>
            <CardTitle>Security</CardTitle>
            <CardDescription>Change the username and password used to sign in. Defaults to admin / admin.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="currentPassword">Current password</Label>
              <Input id="currentPassword" type="password" autoComplete="current-password"
                value={cred.currentPassword}
                onChange={(e) => setCred((c) => ({ ...c, currentPassword: e.target.value }))} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="newUsername">New username</Label>
                <Input id="newUsername" autoComplete="username" value={cred.username}
                  onChange={(e) => setCred((c) => ({ ...c, username: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="newPassword">New password</Label>
                <Input id="newPassword" type="password" autoComplete="new-password" value={cred.password}
                  onChange={(e) => setCred((c) => ({ ...c, password: e.target.value }))} />
              </div>
            </div>
            <Button onClick={saveCredentials}
              disabled={savingCred || !cred.currentPassword || !cred.username.trim() || !cred.password}>
              {savingCred ? "Updating..." : "Update credentials"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Mongosync Binary</CardTitle>
            <CardDescription>Path to the mongosync executable used for all migrations.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="mongosyncPath">Binary Path</Label>
              <div className="flex gap-2">
                <Input id="mongosyncPath" value={s.mongosyncPath}
                  className="font-mono"
                  onChange={(e) => set("mongosyncPath")(e.target.value)} placeholder="mongosync (or full path)" />
                <Button variant="outline" onClick={testBinary} disabled={testing}>
                  {testing ? "Testing..." : "Test"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Path to the <span className="font-mono">mongosync</span> executable, or its containing
                folder (e.g. <span className="font-mono">…/bin/</span>) — the binary inside is used. Leave
                blank to find <span className="font-mono">mongosync</span> on your <span className="font-mono">PATH</span>.
                Saving runs a version check automatically.
              </p>
              {version && <p className="text-sm text-primary">Version: {version}</p>}
              {versionError && <p className="text-sm text-destructive">Error: {versionError}</p>}
            </div>
            <a href="https://www.mongodb.com/docs/mongosync/current/installation/" target="_blank"
              rel="noopener noreferrer" className="text-sm text-primary hover:underline">
              Download mongosync from MongoDB
            </a>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Process &amp; Polling</CardTitle>
            <CardDescription>Control how mongosync processes are launched and monitored.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="basePort">Base Port (first migration&apos;s mongosync port)</Label>
              <Input id="basePort" type="number" value={s.basePort} onChange={(e) => set("basePort")(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pollInterval">Poll Interval (ms)</Label>
              <Input id="pollInterval" type="number" min={1000} max={60000} value={s.pollInterval}
                onChange={(e) => set("pollInterval")(e.target.value)} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>New Migration Defaults</CardTitle>
            <CardDescription>Pre-fill these values when creating a new migration.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="defaultLoadLevel">Default Load Level (1-4)</Label>
              <Input id="defaultLoadLevel" type="number" min={1} max={4} value={s.defaultLoadLevel}
                onChange={(e) => set("defaultLoadLevel")(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="defaultVerbosity">Default Verbosity</Label>
              <select id="defaultVerbosity" className={selectClass}
                value={s.defaultVerbosity} onChange={(e) => set("defaultVerbosity")(e.target.value)}>
                {["TRACE", "DEBUG", "INFO", "WARN", "ERROR", "FATAL", "PANIC"].map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="defaultVerification">Enable Verification by Default</Label>
              <Switch id="defaultVerification" checked={s.defaultVerification === "true"}
                onCheckedChange={(v) => set("defaultVerification")(String(v))} />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="defaultDisableTelemetry">Disable Telemetry by Default</Label>
              <Switch id="defaultDisableTelemetry" checked={s.defaultDisableTelemetry === "true"}
                onCheckedChange={(v) => set("defaultDisableTelemetry")(String(v))} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Data Directory</CardTitle>
            <CardDescription>All runtime data — database, configs, and logs — is stored here.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm font-mono text-muted-foreground">~/.mongosync-ui/</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Supervision &amp; Fault Tolerance</CardTitle>
            <CardDescription>
              How mongosync instances are kept alive. Supervised mode runs each in a tmux session
              with automatic restart on crash or hang.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="supervisionMode">Mode</Label>
              <select id="supervisionMode" className={selectClass}
                value={s.supervisionMode} onChange={(e) => set("supervisionMode")(e.target.value)}>
                <option value="supervised">Supervised (tmux + auto-restart)</option>
                <option value="legacy">Legacy (detached, no auto-restart)</option>
              </select>
              {boot && !boot.tmux && (
                <p className="text-sm text-destructive">
                  tmux not found — supervised mode falls back to legacy. Install tmux to enable fault tolerance.
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="hungTicks">Hung threshold (poll ticks)</Label>
                <Input id="hungTicks" type="number" min={2} value={s.hungTicks}
                  onChange={(e) => set("hungTicks")(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="backoffCapSec">Restart backoff cap (s)</Label>
                <Input id="backoffCapSec" type="number" min={1} value={s.backoffCapSec}
                  onChange={(e) => set("backoffCapSec")(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="crashLoopMax">Crash-loop cap (restarts)</Label>
                <Input id="crashLoopMax" type="number" min={1} value={s.crashLoopMax}
                  onChange={(e) => set("crashLoopMax")(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="crashLoopWindowSec">Crash-loop window (s)</Label>
                <Input id="crashLoopWindowSec" type="number" min={10} value={s.crashLoopWindowSec}
                  onChange={(e) => set("crashLoopWindowSec")(e.target.value)} />
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-border pt-4">
              <div>
                <p className="text-sm font-medium">Start at boot</p>
                <p className="text-xs text-muted-foreground">
                  {boot?.installed ? "Installed" : "Not installed"}
                  {boot ? ` · ${boot.platform === "darwin" ? "launchd" : "systemd --user"}` : ""}
                </p>
              </div>
              {boot?.installed
                ? <Button variant="outline" onClick={() => toggleBoot("uninstall")}>Remove boot service</Button>
                : <Button variant="outline" onClick={() => toggleBoot("install")}>Install boot service</Button>}
            </div>
          </CardContent>
        </Card>

        <Button onClick={save} disabled={saving}>{saving ? "Saving..." : "Save Settings"}</Button>
      </div>
    </>
  );
}
