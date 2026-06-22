import { describe, it, expect } from "vitest";

async function load() {
  return await import("@/lib/process-manager");
}

describe("process-manager liveness", () => {
  it("isProcessAlive returns false for a non-existent PID", async () => {
    const { isProcessAlive } = await load();
    expect(isProcessAlive(99999999)).toBe(false);
  });

  it("isProcessAlive returns true for the current process", async () => {
    const { isProcessAlive } = await load();
    expect(isProcessAlive(process.pid)).toBe(true);
  });
});
