export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

/** Hide the password in a mongodb URI for display: mongodb://user:***@host/… */
export function maskUri(uri: string): string {
  return uri.replace(/(mongodb(?:\+srv)?:\/\/[^:/@]+:)[^@]*(@)/i, "$1***$2");
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/** A parsed mongosync structured-log line, ready for rendering. */
export interface ParsedLogLine {
  /** Local HH:MM:SS time (empty when no timestamp present). */
  time: string;
  /** Lowercased level (e.g. "info", "warn", "error"); empty when unknown. */
  level: string;
  /** Human-readable message (the raw line when it isn't structured JSON). */
  message: string;
  /** True when the line parsed as a structured JSON log object. */
  structured: boolean;
}

/**
 * Parse a single mongosync.log line. mongosync writes one JSON object per line
 * (`{time, level, message, ...}`). Falls back to the raw text for plain lines.
 * Pure + side-effect free so it can be unit-tested without a filesystem.
 */
export function parseLogLine(raw: string): ParsedLogLine {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) {
    return { time: "", level: "", message: raw, structured: false };
  }
  try {
    const obj = JSON.parse(trimmed) as Record<string, unknown>;
    if (typeof obj !== "object" || obj === null) {
      return { time: "", level: "", message: raw, structured: false };
    }
    let time = "";
    if (typeof obj.time === "string") {
      const d = new Date(obj.time);
      if (!Number.isNaN(d.getTime())) time = d.toLocaleTimeString();
    }
    const level = typeof obj.level === "string" ? obj.level.toLowerCase() : "";
    const message = typeof obj.message === "string" ? obj.message : trimmed;
    return { time, level, message, structured: true };
  } catch {
    return { time: "", level: "", message: raw, structured: false };
  }
}

/** A point in a derived time-series, aligned to a sample timestamp. */
export interface DerivedPoint {
  timestamp: number;
  value: number;
}

/**
 * Compute a per-second rate-of-change series from a cumulative counter.
 * For each consecutive pair of samples, value = max(0, Δcounter / Δseconds).
 * Negative deltas (counter resets) clamp to 0. Skips pairs with non-positive
 * time deltas or null endpoints. Returns at most one fewer point than the input
 * (the first sample has no predecessor). Pure + mock-free.
 */
export function deriveRate(
  samples: { timestamp: number; value: number | null }[]
): DerivedPoint[] {
  const out: DerivedPoint[] = [];
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1];
    const cur = samples[i];
    const dt = (cur.timestamp - prev.timestamp) / 1000;
    if (dt <= 0 || prev.value == null || cur.value == null) continue;
    const delta = cur.value - prev.value;
    out.push({ timestamp: cur.timestamp, value: Math.max(0, delta / dt) });
  }
  return out;
}
