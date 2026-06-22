import { describe, it, expect } from "vitest";
import { classifyTick } from "@/lib/health-monitor";

describe("classifyTick", () => {
  it("resets the counter and takes no action when reachable", () => {
    expect(classifyTick(5, "reachable", 6)).toEqual({ consecutive: 0, action: "none" });
  });

  it("increments the counter while below the hung threshold", () => {
    expect(classifyTick(0, "unreachable", 6)).toEqual({ consecutive: 1, action: "none" });
    expect(classifyTick(4, "unreachable", 6)).toEqual({ consecutive: 5, action: "none" });
  });

  it("signals restart exactly when consecutive unreachable hits the threshold", () => {
    expect(classifyTick(5, "unreachable", 6)).toEqual({ consecutive: 6, action: "restart" });
  });

  it("keeps signalling restart while still unreachable past the threshold", () => {
    expect(classifyTick(6, "unreachable", 6)).toEqual({ consecutive: 7, action: "restart" });
  });
});
