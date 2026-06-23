import { describe, it, expect } from "vitest";
import { formatBytes, formatDuration, parseLogLine, deriveRate } from "@/lib/format";

describe("formatBytes", () => {
  it("formats zero and units", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1048576)).toBe("1.0 MB");
  });
});

describe("formatDuration", () => {
  it("formats seconds, minutes, hours", () => {
    expect(formatDuration(45)).toBe("45s");
    expect(formatDuration(90)).toBe("1m 30s");
    expect(formatDuration(3661)).toBe("1h 1m");
  });
});

describe("parseLogLine", () => {
  it("parses a structured mongosync JSON line", () => {
    const raw = JSON.stringify({
      time: "2026-06-23T11:37:01.417922+02:00",
      level: "info",
      message: "Version info",
      pid: 66880,
    });
    const p = parseLogLine(raw);
    expect(p.structured).toBe(true);
    expect(p.level).toBe("info");
    expect(p.message).toBe("Version info");
    expect(p.time).not.toBe(""); // locale-formatted, just ensure populated
  });

  it("lowercases the level", () => {
    expect(parseLogLine('{"level":"ERROR","message":"boom"}').level).toBe("error");
  });

  it("falls back to raw text for non-JSON lines", () => {
    const p = parseLogLine("(NotAReplicaSet) node needs to be a replica set member");
    expect(p.structured).toBe(false);
    expect(p.message).toBe("(NotAReplicaSet) node needs to be a replica set member");
    expect(p.level).toBe("");
  });

  it("falls back to raw text for malformed JSON", () => {
    const p = parseLogLine('{"level":"info", broken');
    expect(p.structured).toBe(false);
    expect(p.message).toBe('{"level":"info", broken');
  });

  it("handles missing time/message gracefully", () => {
    const p = parseLogLine('{"level":"warn"}');
    expect(p.structured).toBe(true);
    expect(p.time).toBe("");
    expect(p.level).toBe("warn");
  });
});

describe("deriveRate", () => {
  it("computes per-second rate from a cumulative counter", () => {
    const out = deriveRate([
      { timestamp: 0, value: 0 },
      { timestamp: 1000, value: 100 }, // +100 over 1s
      { timestamp: 3000, value: 300 }, // +200 over 2s
    ]);
    expect(out).toEqual([
      { timestamp: 1000, value: 100 },
      { timestamp: 3000, value: 100 },
    ]);
  });

  it("clamps counter resets to zero", () => {
    const out = deriveRate([
      { timestamp: 0, value: 500 },
      { timestamp: 1000, value: 100 }, // negative delta
    ]);
    expect(out).toEqual([{ timestamp: 1000, value: 0 }]);
  });

  it("skips pairs with null endpoints or non-positive time deltas", () => {
    const out = deriveRate([
      { timestamp: 0, value: null },
      { timestamp: 1000, value: 100 }, // prev is null -> skipped
      { timestamp: 1000, value: 200 }, // dt == 0 -> skipped
      { timestamp: 2000, value: 400 }, // +200 over 1s
    ]);
    expect(out).toEqual([{ timestamp: 2000, value: 200 }]);
  });

  it("returns empty for a single sample", () => {
    expect(deriveRate([{ timestamp: 0, value: 0 }])).toEqual([]);
  });
});
