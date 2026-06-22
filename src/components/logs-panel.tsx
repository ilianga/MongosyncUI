"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

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
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Logs</h3>
        <div className="flex gap-2">
          <Button size="sm" variant={stream === "stdout" ? "default" : "outline"} onClick={() => setStream("stdout")}>stdout</Button>
          <Button size="sm" variant={stream === "stderr" ? "default" : "outline"} onClick={() => setStream("stderr")}>stderr</Button>
          <Button size="sm" variant="outline" onClick={download}>Download</Button>
        </div>
      </div>
      <div ref={containerRef} className="h-64 overflow-auto rounded-md border bg-black p-3 font-mono text-xs text-green-400">
        {lines.length === 0 ? (
          <p className="text-gray-500">No logs available.</p>
        ) : (
          lines.map((line, i) => <div key={i} className="whitespace-pre-wrap">{line}</div>)
        )}
      </div>
    </div>
  );
}
