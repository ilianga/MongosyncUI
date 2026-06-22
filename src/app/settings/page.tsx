"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Topbar } from "@/components/app-shell/topbar";
import { toast } from "sonner";

interface Settings {
  mongosyncPath: string;
  pollInterval: string;
  basePort: string;
  defaultLoadLevel: string;
  defaultVerbosity: string;
  defaultVerification: string;
  defaultDisableTelemetry: string;
}

const DEFAULTS: Settings = {
  mongosyncPath: "", pollInterval: "5000", basePort: "27182",
  defaultLoadLevel: "3", defaultVerbosity: "INFO",
  defaultVerification: "true", defaultDisableTelemetry: "false",
};

const selectClass =
  "w-full bg-background border border-input rounded-md px-2 py-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export default function SettingsPage() {
  const [s, setS] = useState<Settings>(DEFAULTS);
  const [version, setVersion] = useState<string | null>(null);
  const [versionError, setVersionError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/settings").then((r) => r.json()).then((data) => {
      setS({ ...DEFAULTS, ...Object.fromEntries(Object.entries(data).filter(([, v]) => v !== "")) });
    }).catch(() => {});
  }, []);

  const set = (k: keyof Settings) => (v: string) => setS((prev) => ({ ...prev, [k]: v }));

  const testBinary = async () => {
    setTesting(true); setVersion(null); setVersionError(null);
    try {
      const res = await fetch("/api/mongosync/version");
      const data = await res.json();
      res.ok ? setVersion(data.version) : setVersionError(data.error);
    } catch (e) { setVersionError((e as Error).message); }
    finally { setTesting(false); }
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

        <Button onClick={save} disabled={saving}>{saving ? "Saving..." : "Save Settings"}</Button>
      </div>
    </>
  );
}
