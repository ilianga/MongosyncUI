"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { Metric } from "@/lib/types";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const fmtTime = (ts: number | string) => new Date(Number(ts)).toLocaleTimeString();
// recharts Tooltip.labelFormatter receives ReactNode; cast to avoid TS error
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fmtLabel = (label: any) => fmtTime(label as number);

function Chart({
  data,
  dataKey,
  label,
  color,
  unit,
  gradientId,
}: {
  data: Metric[];
  dataKey: keyof Metric;
  label: string;
  color: string;
  unit?: string;
  gradientId: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--border)"
                strokeOpacity={0.4}
                vertical={false}
              />
              <XAxis
                dataKey="timestamp"
                tickFormatter={fmtTime}
                tick={{
                  fontSize: 10,
                  fill: "var(--muted-foreground)",
                  fontFamily: "var(--font-geist-mono)",
                }}
                stroke="var(--border)"
              />
              <YAxis
                tick={{
                  fontSize: 10,
                  fill: "var(--muted-foreground)",
                  fontFamily: "var(--font-geist-mono)",
                }}
                stroke="var(--border)"
                width={48}
                unit={unit}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--popover)",
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                  fontSize: "12px",
                  color: "var(--popover-foreground)",
                }}
                labelStyle={{ color: "var(--muted-foreground)" }}
                labelFormatter={fmtLabel}
                cursor={{ stroke: "var(--border)" }}
              />
              <Area
                type="monotone"
                dataKey={dataKey}
                stroke={color}
                strokeWidth={2}
                fill={`url(#${gradientId})`}
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

export function MetricsCharts({ metrics }: { metrics: Metric[] }) {
  if (metrics.length === 0) {
    return (
      <p className={cn("text-sm text-muted-foreground text-center py-8")}>
        No metrics data yet.
      </p>
    );
  }
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Chart
        data={metrics}
        dataKey="copyProgress"
        label="Copy Progress %"
        color="#00ED64"
        unit="%"
        gradientId="grad-copyProgress"
      />
      <Chart
        data={metrics}
        dataKey="lagTimeSeconds"
        label="Lag Time"
        color="#FFC010"
        unit="s"
        gradientId="grad-lagTimeSeconds"
      />
      <Chart
        data={metrics}
        dataKey="totalEventsApplied"
        label="Events Applied"
        color="#016BF8"
        gradientId="grad-totalEventsApplied"
      />
      <Chart
        data={metrics}
        dataKey="estimatedCopiedBytes"
        label="Bytes Copied"
        color="#B45AF2"
        gradientId="grad-estimatedCopiedBytes"
      />
    </div>
  );
}
