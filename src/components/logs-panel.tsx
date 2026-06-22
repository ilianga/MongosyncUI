"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function LogsPanel({ migrationId }: { migrationId: string }) {
  const [lines, setLines] = useState<string[]>([]);
  const [stream, setStream] = useState<"stdout" | "stderr">("stdout");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        const res = await fetch(`/api/migrations/${migrationId}/logs?lines=300&stream=${stream}`);
        setLines((await res.json()).lines || []);
      } catch { /* ignore */ }
    };
    fetchLogs();
    const t = setInterval(fetchLogs, 5000);
    return () => clearInterval(t);
  }, [migrationId, stream]);

  useEffect(() => {
    if (containerRef.current) containerRef.current.scrollTop = containerRef.current.scrollHeight;
  }, [lines]);

  const download = () => {
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${migrationId}-${stream}.log`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-2">
      {/* Header strip */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 rounded-md border border-border bg-muted p-0.5">
          <button
            onClick={() => setStream("stdout")}
            className={cn(
              "rounded px-2.5 py-1 text-xs font-mono font-medium transition-colors",
              stream === "stdout"
                ? "bg-secondary text-secondary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            stdout
          </button>
          <button
            onClick={() => setStream("stderr")}
            className={cn(
              "rounded px-2.5 py-1 text-xs font-mono font-medium transition-colors",
              stream === "stderr"
                ? "bg-secondary text-secondary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            stderr
          </button>
        </div>
        <Button size="sm" variant="ghost" onClick={download} className="text-xs">
          Download
        </Button>
      </div>

      {/* Terminal area */}
      <div
        ref={containerRef}
        className="h-80 overflow-auto rounded-lg border bg-[#06212E] p-3 font-mono text-xs text-[#71F6BA] whitespace-pre-wrap"
      >
        {lines.length === 0 ? (
          <p className="text-[#3D4F58]">No output yet.</p>
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
