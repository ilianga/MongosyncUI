import { describe, it, expect } from "vitest";
import { availableActions } from "@/lib/state-machine";

describe("availableActions", () => {
  it("IDLE allows start + delete", () => {
    expect(availableActions("IDLE")).toEqual(["start", "delete"]);
  });
  it("RUNNING allows pause + commit + delete", () => {
    expect(availableActions("RUNNING")).toEqual(["pause", "commit", "delete"]);
  });
  it("PAUSED allows resume + delete", () => {
    expect(availableActions("PAUSED")).toEqual(["resume", "delete"]);
  });
  it("COMMITTED allows reverse + delete", () => {
    expect(availableActions("COMMITTED")).toEqual(["reverse", "delete"]);
  });
  it("COMMITTING and REVERSING are transient (delete only)", () => {
    expect(availableActions("COMMITTING")).toEqual(["delete"]);
    expect(availableActions("REVERSING")).toEqual(["delete"]);
  });
});
