"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useFieldArray, type Control, type UseFormRegister } from "react-hook-form";
import type { MigrationFormValues } from "@/lib/schemas";
import type { ConnectionConfig } from "@/lib/types";

interface NsCollection {
  name: string;
  type: string;
}
interface NsDatabase {
  name: string;
  collections: NsCollection[];
}

export function NamespaceFilterFields({
  control,
  register,
  name,
  label,
  getSourceConn,
}: {
  control: Control<MigrationFormValues>;
  register: UseFormRegister<MigrationFormValues>;
  name: "includeNamespaces" | "excludeNamespaces";
  label: string;
  /**
   * Optional: returns the SOURCE cluster's connection (or null when not yet entered).
   * When provided, a "Browse" affordance fetches live namespaces from the source so the
   * user can pick databases/collections instead of typing them. Omitting it keeps the
   * component working exactly as before (manual entry only) — used by migration-form.
   */
  getSourceConn?: () => ConnectionConfig | null;
}) {
  const fa = useFieldArray({ control, name });
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</Label>
        {getSourceConn && (
          <NamespaceBrowser
            getSourceConn={getSourceConn}
            onAdd={(rows) => rows.forEach((r) => fa.append(r))}
          />
        )}
      </div>
      {fa.fields.map((field, i) => (
        <div key={field.id} className="space-y-1.5 rounded-md border border-border p-2">
          <div className="grid grid-cols-[1fr_1fr_auto] gap-1.5">
            <Input
              placeholder="database"
              className="font-mono text-sm h-8"
              {...register(`${name}.${i}.database`)}
            />
            <Input
              placeholder="collections"
              className="font-mono text-sm h-8"
              {...register(`${name}.${i}.collections`)}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              onClick={() => fa.remove(i)}
              aria-label="Remove row"
            >
              ×
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <Input
              placeholder="databaseRegex (optional)"
              className="font-mono text-sm h-8"
              {...register(`${name}.${i}.databaseRegex`)}
            />
            <Input
              placeholder="collectionsRegex (optional)"
              className="font-mono text-sm h-8"
              {...register(`${name}.${i}.collectionsRegex`)}
            />
          </div>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="border-dashed text-muted-foreground hover:text-foreground"
        onClick={() => fa.append({ database: "", collections: "", databaseRegex: "", collectionsRegex: "" })}
      >
        + Add {label} row
      </Button>
    </div>
  );
}

type Row = { database: string; collections: string; databaseRegex: string; collectionsRegex: string };

/**
 * Live namespace explorer. Fetches user databases + collections from the SOURCE cluster
 * via /api/cluster-check/namespaces, then lets the user tick databases (whole-db filter)
 * or individual collections (collection-level filter). "Add selected" turns the picks into
 * filter rows: a database with no specific collections → one row; a database with specific
 * collections → one row carrying the comma-separated collection list (per the mongosync
 * collection-level-filtering model). The advanced manual/regex inputs remain untouched.
 */
function NamespaceBrowser({
  getSourceConn,
  onAdd,
}: {
  getSourceConn: () => ConnectionConfig | null;
  onAdd: (rows: Row[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dbs, setDbs] = useState<NsDatabase[]>([]);
  // dbName -> set of selected collection names; empty set means "whole database".
  const [selected, setSelected] = useState<Record<string, Set<string>>>({});
  // dbName -> "whole" (entire db) | "some" (pick collections)
  const [mode, setMode] = useState<Record<string, "whole" | "some">>({});

  const load = async () => {
    const conn = getSourceConn();
    if (!conn) {
      setError("Enter the source connection first, then Browse.");
      setOpen(true);
      return;
    }
    setLoading(true);
    setError(null);
    setOpen(true);
    try {
      const res = await fetch("/api/cluster-check/namespaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conn }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to list namespaces");
      setDbs(Array.isArray(data.databases) ? data.databases : []);
      setSelected({});
      setMode({});
    } catch (e) {
      setError((e as Error).message);
      setDbs([]);
    } finally {
      setLoading(false);
    }
  };

  const toggleDbMode = (db: string, m: "whole" | "some") => {
    setMode((prev) => ({ ...prev, [db]: m }));
    if (m === "whole") setSelected((prev) => ({ ...prev, [db]: new Set() }));
    else setSelected((prev) => ({ ...prev, [db]: prev[db] ?? new Set() }));
  };

  const toggleCollection = (db: string, col: string) => {
    setSelected((prev) => {
      const set = new Set(prev[db] ?? new Set());
      if (set.has(col)) set.delete(col);
      else set.add(col);
      return { ...prev, [db]: set };
    });
    setMode((prev) => ({ ...prev, [db]: "some" }));
  };

  const addSelected = () => {
    const rows: Row[] = [];
    for (const db of dbs) {
      const m = mode[db.name];
      if (!m) continue; // db not picked
      const cols = m === "some" ? Array.from(selected[db.name] ?? new Set()) : [];
      if (m === "some" && cols.length === 0) continue; // "some" but nothing ticked → skip
      rows.push({
        database: db.name,
        collections: cols.join(", "),
        databaseRegex: "",
        collectionsRegex: "",
      });
    }
    if (rows.length) onAdd(rows);
    setOpen(false);
  };

  return (
    <div className="relative">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 text-xs"
        onClick={() => (open ? setOpen(false) : load())}
      >
        {open ? "Close" : "Browse source…"}
      </Button>

      {open && (
        <div className="absolute right-0 z-20 mt-1 w-80 rounded-md border border-border bg-background p-3 shadow-lg">
          {loading && <p className="text-xs text-muted-foreground">Loading namespaces…</p>}
          {error && <p className="text-xs text-destructive">{error}</p>}
          {!loading && !error && dbs.length === 0 && (
            <p className="text-xs text-muted-foreground">No user databases found.</p>
          )}
          {!loading && !error && dbs.length > 0 && (
            <>
              <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                {dbs.map((db) => {
                  const m = mode[db.name];
                  const sel = selected[db.name] ?? new Set();
                  return (
                    <div key={db.name} className="rounded border border-border/60 p-1.5">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={!!m}
                          onChange={(e) =>
                            e.target.checked
                              ? toggleDbMode(db.name, "whole")
                              : (setMode((p) => {
                                  const n = { ...p };
                                  delete n[db.name];
                                  return n;
                                }),
                                setSelected((p) => {
                                  const n = { ...p };
                                  delete n[db.name];
                                  return n;
                                }))
                          }
                        />
                        <span className="font-mono text-xs font-semibold">{db.name}</span>
                        {m && (
                          <select
                            className="ml-auto rounded border border-input bg-background px-1 py-0.5 text-[10px]"
                            value={m}
                            onChange={(e) => toggleDbMode(db.name, e.target.value as "whole" | "some")}
                          >
                            <option value="whole">whole db</option>
                            <option value="some">pick collections</option>
                          </select>
                        )}
                      </div>
                      {m === "some" && (
                        <div className="ml-5 mt-1 space-y-0.5">
                          {db.collections.length === 0 && (
                            <p className="text-[10px] text-muted-foreground">No collections.</p>
                          )}
                          {db.collections.map((c) => (
                            <label key={c.name} className="flex items-center gap-1.5 text-[11px]">
                              <input
                                type="checkbox"
                                checked={sel.has(c.name)}
                                onChange={() => toggleCollection(db.name, c.name)}
                              />
                              <span className="font-mono">{c.name}</span>
                              {c.type !== "collection" && (
                                <span className="text-muted-foreground">({c.type})</span>
                              )}
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="mt-2 flex justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button type="button" size="sm" className="h-7 text-xs" onClick={addSelected}>
                  Add selected
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
