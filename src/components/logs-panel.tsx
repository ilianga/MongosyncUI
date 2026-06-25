"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { parseLogLine } from "@/lib/format";

type Stream = "mongosync" | "process";

const TABS: { id: Stream; label: string }[] = [
  { id: "mongosync", label: "mongosync" },
  { id: "process", label: "process" },
];

// Terminal colours for log levels (kept close to the panel's mongo-shell palette).
function levelColor(level: string): string {
  switch (level) {
    case "error":
    case "fatal":
    case "panic":
      return "text-[#FF6960]";
    case "warn":
    case "warning":
      return "text-[#FFC010]";
    case "info":
    case "debug":
    case "trace":
      return "text-[#3D8FD6]";
    default:
      return "text-[#3D4F58]";
  }
}

// Sentinel value for the root (coordinator) log dir in the shard selector.
const ROOT_SHARD = "";

export function LogsPanel({
  migrationId,
  shards,
}: {
  migrationId: string;
  /**
   * Optional source shard ids. When provided (sharded migration), a selector lets the user
   * tail a specific instance's logs (logs/<id>/<shard>/) or the coordinator/root dir.
   */
  shards?: string[];
}) {
  const [lines, setLines] = useState<string[]>([]);
  const [stream, setStream] = useState<Stream>("mongosync");
  const [shard, setShard] = useState<string>(ROOT_SHARD);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchLogs = async () => {
      try {
        const shardQuery = shard ? `&shard=${encodeURIComponent(shard)}` : "";
        const res = await fetch(
          `/api/migrations/${migrationId}/logs?lines=300&stream=${stream}${shardQuery}`
        );
        const data = await res.json();
        if (!cancelled) setLines(data.lines || []);
      } catch {
        /* ignore */
      }
    };
    fetchLogs();
    const t = setInterval(fetchLogs, 5000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [migrationId, stream, shard]);

  useEffect(() => {
    if (containerRef.current) containerRef.current.scrollTop = containerRef.current.scrollHeight;
  }, [lines]);

  const download = () => {
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${migrationId}${shard ? `-${shard}` : ""}-${stream}.log`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-2">
      {/* Header strip */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 rounded-md border border-border bg-muted p-0.5">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setStream(tab.id)}
              className={cn(
                "rounded px-2.5 py-1 text-xs font-mono font-medium transition-colors",
                stream === tab.id
                  ? "bg-secondary text-secondary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {shards && shards.length > 0 && (
            <select
              value={shard}
              onChange={(e) => setShard(e.target.value)}
              aria-label="Select shard logs"
              className="rounded-md border border-input bg-background px-2 py-1 text-xs font-mono text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value={ROOT_SHARD}>coordinator</option>
              {shards.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          )}
          <Button size="sm" variant="ghost" onClick={download} className="text-xs">
            Download
          </Button>
        </div>
      </div>

      {/* Terminal area */}
      <div
        ref={containerRef}
        className="h-80 overflow-auto rounded-lg border bg-[#06212E] p-3 font-mono text-xs text-[#71F6BA]"
      >
        {lines.length === 0 ? (
          <p className="text-[#3D4F58]">No output yet.</p>
        ) : stream === "mongosync" ? (
          lines.map((line, i) => {
            const p = parseLogLine(line);
            if (!p.structured) {
              return (
                <div key={i} className="whitespace-pre-wrap leading-relaxed text-[#3D4F58]">
                  {line}
                </div>
              );
            }
            return (
              <div key={i} className="flex gap-2 leading-relaxed">
                {p.time && <span className="shrink-0 text-[#3D4F58]">{p.time}</span>}
                <span className={cn("w-12 shrink-0 uppercase tabular-nums", levelColor(p.level))}>
                  {p.level}
                </span>
                <span className="whitespace-pre-wrap break-words text-[#C3E7FE]">{p.message}</span>
              </div>
            );
          })
        ) : (
          lines.map((line, i) => (
            <div key={i} className="whitespace-pre-wrap leading-relaxed">
              {line}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
