import { describe, it, expect } from "vitest";
import { isMsyncSessionName } from "@/lib/sessions";

describe("isMsyncSessionName", () => {
  it("accepts msync-prefixed session names", () => {
    expect(isMsyncSessionName("msync-abc123")).toBe(true);
    expect(isMsyncSessionName("msync-abc-shard01")).toBe(true);
  });
  it("rejects anything not a mongosync session (guards killSession)", () => {
    expect(isMsyncSessionName("other-session")).toBe(false);
    expect(isMsyncSessionName("msync- ; rm -rf")).toBe(false); // contains a space
    expect(isMsyncSessionName("")).toBe(false);
    expect(isMsyncSessionName(123)).toBe(false);
    expect(isMsyncSessionName(null)).toBe(false);
  });
});
