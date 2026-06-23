"use client";

import {
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import type { Metric } from "@/lib/types";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatBytes, formatDuration, deriveRate } from "@/lib/format";

const fmtTime = (ts: number | string) => new Date(Number(ts)).toLocaleTimeString();
// recharts formatters receive ReactNode-ish values; cast at the boundary.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fmtLabel = (label: any) => fmtTime(label as number);

const COLORS = {
  green: "#00ED64",
  amber: "#FFC010",
  blue: "#016BF8",
  purple: "#B45AF2",
  red: "#FF6960",
  cyan: "#0498EC",
  teal: "#13AA52",
};

const axisTick = {
  fontSize: 10,
  fill: "var(--muted-foreground)",
  fontFamily: "var(--font-geist-mono)",
} as const;

const tooltipContentStyle = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: "8px",
  fontSize: "12px",
  color: "var(--popover-foreground)",
} as const;

type ValueFormatter = (v: number) => string;

const ChartShell = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <Card>
    <CardHeader>
      <CardTitle className="text-sm">{title}</CardTitle>
    </CardHeader>
    <CardContent>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </CardContent>
  </Card>
);

/** Single-series area chart over a Metric numeric field or a derived series. */
function Chart({
  title,
  data,
  dataKey,
  color,
  gradientId,
  valueFormatter,
}: {
  title: string;
  data: readonly object[];
  dataKey: string;
  color: string;
  gradientId: string;
  valueFormatter?: ValueFormatter;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tickFmt = valueFormatter ? (v: any) => valueFormatter(Number(v)) : undefined;
  return (
    <ChartShell title={title}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.4} vertical={false} />
        <XAxis dataKey="timestamp" tickFormatter={fmtTime} tick={axisTick} stroke="var(--border)" />
        <YAxis tick={axisTick} stroke="var(--border)" width={56} tickFormatter={tickFmt} />
        <Tooltip
          contentStyle={tooltipContentStyle}
          labelStyle={{ color: "var(--muted-foreground)" }}
          labelFormatter={fmtLabel}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          formatter={(v: any) => [valueFormatter ? valueFormatter(Number(v)) : v, title]}
          cursor={{ stroke: "var(--border)" }}
        />
        <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} fill={`url(#${gradientId})`} dot={false} />
      </AreaChart>
    </ChartShell>
  );
}

/** Multi-series line chart (e.g. source vs destination ping). */
function MultiChart({
  title,
  data,
  series,
  valueFormatter,
}: {
  title: string;
  data: readonly object[];
  series: { dataKey: string; name: string; color: string }[];
  valueFormatter?: ValueFormatter;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tickFmt = valueFormatter ? (v: any) => valueFormatter(Number(v)) : undefined;
  return (
    <ChartShell title={title}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.4} vertical={false} />
        <XAxis dataKey="timestamp" tickFormatter={fmtTime} tick={axisTick} stroke="var(--border)" />
        <YAxis tick={axisTick} stroke="var(--border)" width={56} tickFormatter={tickFmt} />
        <Tooltip
          contentStyle={tooltipContentStyle}
          labelStyle={{ color: "var(--muted-foreground)" }}
          labelFormatter={fmtLabel}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          formatter={(v: any, name: any) => [valueFormatter ? valueFormatter(Number(v)) : v, name]}
          cursor={{ stroke: "var(--border)" }}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {series.map((s) => (
          <Line
            key={s.dataKey}
            type="monotone"
            dataKey={s.dataKey}
            name={s.name}
            stroke={s.color}
            strokeWidth={2}
            dot={false}
            connectNulls
          />
        ))}
      </LineChart>
    </ChartShell>
  );
}

// Value formatters -----------------------------------------------------------
const fmtPct: ValueFormatter = (v) => `${Math.round(v)}%`;
const fmtMs: ValueFormatter = (v) => `${Math.round(v)} ms`;
const fmtSec: ValueFormatter = (v) => formatDuration(v);
const fmtBytesAxis: ValueFormatter = (v) => formatBytes(v);
const fmtBytesPerSec: ValueFormatter = (v) => `${formatBytes(v)}/s`;
const fmtPerSec: ValueFormatter = (v) =>
  v >= 1000 ? `${(v / 1000).toFixed(1)}k/s` : `${Math.round(v)}/s`;
const fmtCount: ValueFormatter = (v) =>
  v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${v}`;

export function MetricsCharts({ metrics }: { metrics: Metric[] }) {
  if (metrics.length === 0) {
    return (
      <p className={cn("text-sm text-muted-foreground text-center py-8")}>No metrics data yet.</p>
    );
  }

  // Derived rate series (one fewer point than the raw samples).
  const throughput = deriveRate(
    metrics.map((m) => ({ timestamp: m.timestamp, value: m.estimatedCopiedBytes }))
  ).map((p) => ({ timestamp: p.timestamp, throughput: p.value }));

  const eventRate = deriveRate(
    metrics.map((m) => ({ timestamp: m.timestamp, value: m.totalEventsApplied }))
  ).map((p) => ({ timestamp: p.timestamp, eps: p.value }));

  const hasPing = metrics.some((m) => m.sourcePingMs != null || m.destPingMs != null);
  const hasCatchup = metrics.some((m) => m.estimatedSecondsToCEACatchup != null);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Chart
        title="Copy Progress"
        data={metrics}
        dataKey="copyProgress"
        color={COLORS.green}
        gradientId="grad-copyProgress"
        valueFormatter={fmtPct}
      />
      <Chart
        title="Bytes Copied"
        data={metrics}
        dataKey="estimatedCopiedBytes"
        color={COLORS.purple}
        gradientId="grad-bytesCopied"
        valueFormatter={fmtBytesAxis}
      />
      {throughput.length > 0 && (
        <Chart
          title="Copy Throughput"
          data={throughput}
          dataKey="throughput"
          color={COLORS.teal}
          gradientId="grad-throughput"
          valueFormatter={fmtBytesPerSec}
        />
      )}
      <Chart
        title="Lag Time"
        data={metrics}
        dataKey="lagTimeSeconds"
        color={COLORS.amber}
        gradientId="grad-lag"
        valueFormatter={fmtSec}
      />
      <Chart
        title="Events Applied"
        data={metrics}
        dataKey="totalEventsApplied"
        color={COLORS.blue}
        gradientId="grad-events"
        valueFormatter={fmtCount}
      />
      {eventRate.length > 0 && (
        <Chart
          title="Change Events / sec"
          data={eventRate}
          dataKey="eps"
          color={COLORS.cyan}
          gradientId="grad-eps"
          valueFormatter={fmtPerSec}
        />
      )}
      {hasCatchup && (
        <Chart
          title="CEA Catchup ETA"
          data={metrics}
          dataKey="estimatedSecondsToCEACatchup"
          color={COLORS.red}
          gradientId="grad-catchup"
          valueFormatter={fmtSec}
        />
      )}
      {hasPing && (
        <MultiChart
          title="Ping Latency"
          data={metrics}
          series={[
            { dataKey: "sourcePingMs", name: "source", color: COLORS.green },
            { dataKey: "destPingMs", name: "destination", color: COLORS.blue },
          ]}
          valueFormatter={fmtMs}
        />
      )}
      <Chart
        title="Process CPU"
        data={metrics}
        dataKey="cpuPercent"
        color={COLORS.red}
        gradientId="grad-cpu"
        valueFormatter={fmtPct}
      />
      <Chart
        title="Process Memory (RSS)"
        data={metrics}
        dataKey="rssBytes"
        color={COLORS.cyan}
        gradientId="grad-rss"
        valueFormatter={fmtBytesAxis}
      />
    </div>
  );
}
