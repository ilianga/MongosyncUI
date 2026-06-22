import { describe, it, expect } from "vitest";
import type { ProgressResponse } from "@/lib/process-manager";

async function load() {
  return await import("@/lib/poller");
}

const sample: ProgressResponse = {
  success: true,
  progress: {
    state: "RUNNING",
    canCommit: true,
    canWrite: false,
    lagTimeSeconds: 3,
    totalEventsApplied: 1000,
    estimatedSecondsToCEACatchup: 12,
    collectionCopy: { estimatedCopiedBytes: 5000, estimatedTotalBytes: 10000 },
    indexBuilding: { indexesBuilt: 2, totalIndexesToBuild: 8 },
    source: { pingLatencyMs: 15 },
    destination: { pingLatencyMs: 22 },
  },
};

describe("progressToMetric", () => {
  it("derives copyProgress from bytes and maps fields", async () => {
    const { progressToMetric } = await load();
    const m = progressToMetric("mig1", sample);
    expect(m.migrationId).toBe("mig1");
    expect(m.state).toBe("RUNNING");
    expect(m.copyProgress).toBe(50);
    expect(m.estimatedCopiedBytes).toBe(5000);
    expect(m.lagTimeSeconds).toBe(3);
    expect(m.totalEventsApplied).toBe(1000);
    expect(m.estimatedSecondsToCEACatchup).toBe(12);
    expect(m.indexesBuilt).toBe(2);
    expect(m.totalIndexesToBuild).toBe(8);
    expect(m.sourcePingMs).toBe(15);
    expect(m.destPingMs).toBe(22);
  });

  it("defaults copyProgress to 0 when total bytes is 0 or missing", async () => {
    const { progressToMetric } = await load();
    const m = progressToMetric("mig1", { success: true, progress: { state: "RUNNING", canCommit: false, canWrite: false } });
    expect(m.copyProgress).toBe(0);
    expect(m.indexesBuilt).toBe(0);
    expect(m.sourcePingMs).toBeNull();
  });
});
