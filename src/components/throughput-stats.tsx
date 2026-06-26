"use client";

import { Stat } from "@/components/ui/stat";
import { formatBytes, formatDuration, deriveRate } from "@/lib/format";
import { computeMigrationProgress } from "@/lib/progress";
import type { Metric } from "@/lib/types";

// Average the per-second rate over the last `window` samples of a cumulative counter.
// Returns null when there's not enough signal to derive a meaningful rate.
function avgRate(metrics: Metric[], pick: (m: Metric) => number | null, window = 10): number | null {
  const tail = metrics.slice(-window);
  const samples = tail.map((m) => ({ timestamp: m.timestamp, value: pick(m) }));
  const rates = deriveRate(samples);
  if (rates.length === 0) return null;
  return rates.reduce((sum, r) => sum + r.value, 0) / rates.length;
}

export function ThroughputStats({ metrics }: { metrics: Metric[] }) {
  const latest = metrics.length ? metrics[metrics.length - 1] : undefined;

  const copyRate = avgRate(metrics, (m) => m.estimatedCopiedBytes);
  const eventRate = avgRate(metrics, (m) => m.totalEventsApplied);
  const lag = latest?.lagTimeSeconds ?? null;

  const progress = computeMigrationProgress(metrics, latest?.state ?? "IDLE");
  const copyEta = progress.phase === "copy" ? progress.etaSec : null;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Stat
        label="Copy Throughput"
        value={copyRate != null ? `${formatBytes(copyRate)}/s` : "—"}
        mono
      />
      <Stat
        label="Change Events / s"
        value={eventRate != null ? Math.round(eventRate).toLocaleString() : "—"}
        mono
      />
      <Stat
        label="Current Lag"
        value={lag != null ? formatDuration(lag) : "—"}
        mono
      />
      <Stat
        label="ETA to Copy Done"
        value={copyEta != null ? formatDuration(copyEta) : "—"}
        mono
      />
    </div>
  );
}
