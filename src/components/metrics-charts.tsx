"use client";

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import type { Metric } from "@/lib/types";

const fmtTime = (ts: number | string) => new Date(Number(ts)).toLocaleTimeString();
// recharts Tooltip.labelFormatter receives ReactNode; cast to avoid TS error
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fmtLabel = (label: any) => fmtTime(label as number);

function Chart({ data, dataKey, label, color, unit }: {
  data: Metric[]; dataKey: keyof Metric; label: string; color: string; unit?: string;
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">{label}</h3>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="timestamp" tickFormatter={fmtTime} tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} unit={unit} />
            <Tooltip labelFormatter={fmtLabel} />
            <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function MetricsCharts({ metrics }: { metrics: Metric[] }) {
  if (metrics.length === 0) return <p className="text-sm text-muted-foreground">No metrics data yet.</p>;
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Chart data={metrics} dataKey="copyProgress" label="Copy Progress %" color="#2563eb" unit="%" />
      <Chart data={metrics} dataKey="lagTimeSeconds" label="Lag Time" color="#dc2626" unit="s" />
      <Chart data={metrics} dataKey="totalEventsApplied" label="Events Applied" color="#16a34a" />
      <Chart data={metrics} dataKey="estimatedCopiedBytes" label="Bytes Copied" color="#9333ea" />
    </div>
  );
}
