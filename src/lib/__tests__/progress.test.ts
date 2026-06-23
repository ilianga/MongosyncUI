import { describe, it, expect } from "vitest";
import { computeMigrationProgress, toProgressGlimpse } from "@/lib/progress";
import type { Metric } from "@/lib/types";

// Build a Metric with sane defaults; override only what a test cares about.
function metric(over: Partial<Metric> = {}): Metric {
  return {
    id: 1,
    migrationId: "m1",
    state: "RUNNING",
    copyProgress: 0,
    canCommit: 0,
    estimatedCopiedBytes: 0,
    estimatedTotalBytes: 0,
    lagTimeSeconds: null,
    totalEventsApplied: 0,
    estimatedSecondsToCEACatchup: null,
    indexesBuilt: 0,
    totalIndexesToBuild: 0,
    sourcePingMs: null,
    destPingMs: null,
    cpuPercent: null,
    rssBytes: null,
    uptimeSec: null,
    timestamp: 0,
    ...over,
  };
}

// A rising-bytes copy series: each sample 10s apart, +1GB copied.
function risingCopySeries(): Metric[] {
  const GB = 1_000_000_000;
  return [0, 1, 2, 3, 4, 5].map((i) =>
    metric({
      timestamp: i * 10_000,
      copyProgress: i * 10,
      estimatedCopiedBytes: i * GB,
      estimatedTotalBytes: 10 * GB,
    })
  );
}

describe("computeMigrationProgress — phase determination", () => {
  it("returns idle with null ETA for an empty metric series", () => {
    const r = computeMigrationProgress([], "RUNNING");
    expect(r.phase).toBe("idle");
    expect(r.etaSec).toBeNull();
    expect(r.phaseProgressPct).toBeNull();
    expect(r.pipeline.every((s) => s.state === "pending")).toBe(true);
  });

  it("mid-copy with rising bytes → copy phase + finite ETA", () => {
    const r = computeMigrationProgress(risingCopySeries(), "RUNNING", {
      plannedTotalBytes: 10_000_000_000,
    });
    expect(r.phase).toBe("copy");
    expect(r.phaseProgressPct).toBe(50);
    expect(r.etaSec).not.toBeNull();
    // 5GB remaining at ~100MB/s ≈ 50s.
    expect(r.etaSec!).toBeGreaterThan(40);
    expect(r.etaSec!).toBeLessThan(60);
    // Pipeline: copy active, rest pending.
    expect(r.pipeline.find((s) => s.phase === "copy")!.state).toBe("active");
    expect(r.pipeline.find((s) => s.phase === "index")!.state).toBe("pending");
  });

  it("copy ETA is null when throughput ≈ 0 (stalled)", () => {
    const flat = [0, 1, 2, 3].map((i) =>
      metric({
        timestamp: i * 10_000,
        copyProgress: 30,
        estimatedCopiedBytes: 3_000_000_000,
        estimatedTotalBytes: 10_000_000_000,
      })
    );
    const r = computeMigrationProgress(flat, "RUNNING");
    expect(r.phase).toBe("copy");
    expect(r.etaSec).toBeNull();
  });

  it("copy ETA is null with too few samples (single metric)", () => {
    const r = computeMigrationProgress(
      [metric({ copyProgress: 20, estimatedCopiedBytes: 2e9, estimatedTotalBytes: 1e10 })],
      "RUNNING"
    );
    expect(r.phase).toBe("copy");
    expect(r.etaSec).toBeNull();
  });

  it("copy done + indexes building → index phase, null ETA", () => {
    const r = computeMigrationProgress(
      [metric({ copyProgress: 100, indexesBuilt: 3, totalIndexesToBuild: 12 })],
      "RUNNING"
    );
    expect(r.phase).toBe("index");
    expect(r.etaSec).toBeNull();
    expect(r.phaseProgressPct).toBe(25);
    expect(r.detail).toBe("3 / 12 indexes");
  });

  it("copy done + lag>0 → cea phase + mongosync ETA", () => {
    const series = [
      metric({ timestamp: 0, copyProgress: 100, lagTimeSeconds: 20 }),
      metric({
        timestamp: 10_000,
        copyProgress: 100,
        lagTimeSeconds: 8,
        estimatedSecondsToCEACatchup: 180,
      }),
    ];
    const r = computeMigrationProgress(series, "RUNNING");
    expect(r.phase).toBe("cea");
    expect(r.etaSec).toBe(180); // latest metric's estimatedSecondsToCEACatchup
    expect(r.detail).toBe("lag 8s");
    // lag fell from 20 (max) to 8 → ~60% caught up.
    expect(r.phaseProgressPct).toBeCloseTo(60, 0);
  });

  it("canCommit → ready phase, 100%, null ETA", () => {
    const r = computeMigrationProgress(
      [metric({ copyProgress: 100, canCommit: 1, lagTimeSeconds: 1 })],
      "RUNNING"
    );
    expect(r.phase).toBe("ready");
    expect(r.phaseProgressPct).toBe(100);
    expect(r.etaSec).toBeNull();
    // Whole pipeline filled.
    expect(r.pipeline.find((s) => s.phase === "ready")!.state).toBe("active");
    expect(r.pipeline.find((s) => s.phase === "copy")!.state).toBe("done");
  });

  it("canCommit wins even mid-copy reported progress", () => {
    const r = computeMigrationProgress([metric({ copyProgress: 40, canCommit: 1 })], "RUNNING");
    expect(r.phase).toBe("ready");
  });
});

describe("computeMigrationProgress — lifecycle states", () => {
  it("COMMITTING → committing phase", () => {
    const r = computeMigrationProgress([metric({ copyProgress: 100, canCommit: 1 })], "COMMITTING");
    expect(r.phase).toBe("committing");
    expect(r.etaSec).toBeNull();
    expect(r.pipeline.every((s) => s.state === "done")).toBe(true);
  });

  it("COMMITTED → committed phase, 100%", () => {
    const r = computeMigrationProgress([metric()], "COMMITTED");
    expect(r.phase).toBe("committed");
    expect(r.phaseProgressPct).toBe(100);
  });

  it("REVERSING → reversing phase", () => {
    const r = computeMigrationProgress([metric()], "REVERSING");
    expect(r.phase).toBe("reversing");
  });

  it("lifecycle states win even with no metrics", () => {
    expect(computeMigrationProgress([], "COMMITTED").phase).toBe("committed");
  });
});

describe("computeMigrationProgress — purity & edge cases", () => {
  it("copy phase prefers plannedTotalBytes over estimatedTotalBytes for ETA", () => {
    const series = risingCopySeries().map((m) => ({ ...m, estimatedTotalBytes: 5_000_000_000 }));
    // With planned=20GB and copied=5GB, far more remaining than the 5GB estimate would imply.
    const r = computeMigrationProgress(series, "RUNNING", { plannedTotalBytes: 20_000_000_000 });
    expect(r.phase).toBe("copy");
    expect(r.etaSec!).toBeGreaterThan(100); // 15GB remaining at ~100MB/s
  });

  it("is deterministic / pure (same input → same output)", () => {
    const s = risingCopySeries();
    const a = computeMigrationProgress(s, "RUNNING", { plannedTotalBytes: 1e10 });
    const b = computeMigrationProgress(s, "RUNNING", { plannedTotalBytes: 1e10 });
    expect(a).toEqual(b);
  });

  it("copy done, lag 0, not canCommit, no index work → cea at 100%", () => {
    const r = computeMigrationProgress(
      [metric({ copyProgress: 100, lagTimeSeconds: 0 })],
      "RUNNING"
    );
    expect(r.phase).toBe("cea");
    expect(r.phaseProgressPct).toBe(100);
  });
});

describe("toProgressGlimpse", () => {
  it("projects only the compact fields", () => {
    const full = computeMigrationProgress(risingCopySeries(), "RUNNING", {
      plannedTotalBytes: 1e10,
    });
    const g = toProgressGlimpse(full);
    expect(g).toEqual({
      phase: full.phase,
      phaseLabel: full.phaseLabel,
      phaseProgressPct: full.phaseProgressPct,
      etaSec: full.etaSec,
      detail: full.detail,
    });
    expect("pipeline" in g).toBe(false);
  });
});
