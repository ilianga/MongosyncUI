import { describe, it, expect } from "vitest";
import { aggregateInstanceProgress, rollupState } from "@/lib/aggregate-progress";
import type { ProgressResponse } from "@/lib/process-manager";

function p(progress: Partial<NonNullable<ProgressResponse["progress"]>>): ProgressResponse {
  return { success: true, progress: { state: "RUNNING", canCommit: false, canWrite: false, ...progress } };
}

describe("rollupState", () => {
  it("returns the common state when all agree", () => {
    expect(rollupState(["RUNNING", "RUNNING", "RUNNING"])).toBe("RUNNING");
    expect(rollupState(["COMMITTED", "COMMITTED"])).toBe("COMMITTED");
  });

  it("reports the earliest state when instances disagree", () => {
    // one shard still RUNNING holds the whole migration back from COMMITTING
    expect(rollupState(["RUNNING", "COMMITTING"])).toBe("RUNNING");
    expect(rollupState(["IDLE", "RUNNING"])).toBe("IDLE");
    expect(rollupState(["INITIALIZING", "RUNNING", "RUNNING"])).toBe("INITIALIZING");
  });

  it("stays COMMITTING while any instance is committing (blocking commit)", () => {
    expect(rollupState(["COMMITTING", "COMMITTED"])).toBe("COMMITTING");
    expect(rollupState(["COMMITTED", "COMMITTED", "COMMITTING"])).toBe("COMMITTING");
  });

  it("only COMMITTED once every instance is committed", () => {
    expect(rollupState(["COMMITTED", "COMMITTED", "COMMITTED"])).toBe("COMMITTED");
  });

  it("defaults to INITIALIZING for empty/unknown", () => {
    expect(rollupState([])).toBe("INITIALIZING");
    expect(rollupState([null, undefined, "BOGUS"])).toBe("INITIALIZING");
  });
});

describe("aggregateInstanceProgress", () => {
  it("sums bytes/events, takes max lag, and rolls up state", () => {
    const agg = aggregateInstanceProgress([
      p({ state: "RUNNING", collectionCopy: { estimatedCopiedBytes: 100, estimatedTotalBytes: 400 }, lagTimeSeconds: 3, totalEventsApplied: 10 }),
      p({ state: "RUNNING", collectionCopy: { estimatedCopiedBytes: 200, estimatedTotalBytes: 600 }, lagTimeSeconds: 9, totalEventsApplied: 25 }),
    ]);
    expect(agg.estimatedCopiedBytes).toBe(300);
    expect(agg.estimatedTotalBytes).toBe(1000);
    expect(agg.lagTimeSeconds).toBe(9); // max
    expect(agg.totalEventsApplied).toBe(35); // sum
    expect(agg.state).toBe("RUNNING");
    expect(agg.copyProgress).toBeCloseTo(30); // 300/1000
  });

  it("canCommit only when every instance is reachable AND canCommit", () => {
    const allYes = aggregateInstanceProgress([
      p({ canCommit: true }),
      p({ canCommit: true }),
    ]);
    expect(allYes.canCommit).toBe(true);

    const oneNo = aggregateInstanceProgress([
      p({ canCommit: true }),
      p({ canCommit: false }),
    ]);
    expect(oneNo.canCommit).toBe(false);
  });

  it("canCommit is false when an instance is unreachable (null)", () => {
    const agg = aggregateInstanceProgress([p({ canCommit: true }), null]);
    expect(agg.canCommit).toBe(false);
    expect(agg.reachableCount).toBe(1);
    expect(agg.instanceCount).toBe(2);
  });

  it("uses plannedTotalBytes as the copy denominator when given", () => {
    const agg = aggregateInstanceProgress(
      [p({ collectionCopy: { estimatedCopiedBytes: 250, estimatedTotalBytes: 100 } })],
      1000
    );
    expect(agg.copyProgress).toBeCloseTo(25); // 250/1000, not 250/100
  });

  it("handles all-unreachable: zeros, INITIALIZING, not committable", () => {
    const agg = aggregateInstanceProgress([null, null]);
    expect(agg.reachableCount).toBe(0);
    expect(agg.canCommit).toBe(false);
    expect(agg.state).toBe("INITIALIZING");
    expect(agg.copyProgress).toBe(0);
    expect(agg.lagTimeSeconds).toBeNull();
  });

  it("rolls up a mixed RUNNING/COMMITTING set to RUNNING (slowest shard wins)", () => {
    const agg = aggregateInstanceProgress([
      p({ state: "RUNNING", canCommit: false }),
      p({ state: "COMMITTING", canCommit: true }),
    ]);
    expect(agg.state).toBe("RUNNING");
    expect(agg.canCommit).toBe(false);
  });
});
