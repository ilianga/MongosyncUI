import { describe, it, expect } from "vitest";
import { availableActions } from "@/lib/state-machine";

describe("availableActions", () => {
  it("IDLE allows start + delete", () => {
    expect(availableActions("IDLE")).toEqual(["start", "delete"]);
  });
  it("RUNNING allows pause + commit + stop + delete", () => {
    expect(availableActions("RUNNING")).toEqual(["pause", "commit", "stop", "delete"]);
  });
  it("PAUSED allows resume + stop + delete", () => {
    expect(availableActions("PAUSED")).toEqual(["resume", "stop", "delete"]);
  });
  it("COMMITTED allows reverse + delete", () => {
    expect(availableActions("COMMITTED")).toEqual(["reverse", "delete"]);
  });
  it("COMMITTING and REVERSING are transient (delete only)", () => {
    expect(availableActions("COMMITTING")).toEqual(["delete"]);
    expect(availableActions("REVERSING")).toEqual(["delete"]);
  });
  it("a stopped migration only offers restart + delete, regardless of state", () => {
    expect(availableActions("RUNNING", true)).toEqual(["restart", "delete"]);
    expect(availableActions("PAUSED", true)).toEqual(["restart", "delete"]);
  });
});
